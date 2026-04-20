const cron = require('node-cron');
const pool = require('../db/pool');
const { sendWhatsApp, getNotifSetting, isNotifEnabled } = require('./whatsapp');


async function sendDailyReport() {
  if (!(await isNotifEnabled('notif_daily_report'))) return;
  try {
    const todayStart = new Date();
    todayStart.setHours(9, 0, 0, 0);
    const todayStr = new Date().toISOString().split('T')[0];

    // Revenue du jour (chatter shifts)
    const { rows: revRows } = await pool.query(
      "SELECT model_name, COALESCE(SUM(ppv_total),0) as ppv, COALESCE(SUM(tips_total),0) as tips FROM chatter_shifts WHERE date = $1 GROUP BY model_name ORDER BY (SUM(ppv_total) + SUM(tips_total)) DESC",
      [todayStr]
    );
    const totalRevenue = revRows.reduce((s, r) => s + parseFloat(r.ppv) + parseFloat(r.tips), 0);
    const top3 = revRows.slice(0, 3);

    // Leads du jour
    const { rows: leadStats } = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE created_at >= $1) as leads_today,
        COUNT(*) FILTER (WHERE sent_at >= $1) as dms_today,
        COUNT(*) FILTER (WHERE status = 'signed' AND updated_at >= $1) as signed_today
      FROM student_leads
    `, [todayStart.toISOString()]);
    const ls = leadStats[0];

    // Leads outreach du jour
    const { rows: outreachStats } = await pool.query(`
      SELECT COUNT(*) FILTER (WHERE created_at >= $1) as contacted,
             COUNT(*) FILTER (WHERE status = 'signed' AND updated_at >= $1) as signed
      FROM outreach_leads
    `, [todayStart.toISOString()]);
    const os = outreachStats[0];
    const totalContacted = parseInt(ls.leads_today) + parseInt(os.contacted);
    const totalSigned = parseInt(ls.signed_today) + parseInt(os.signed);

    // Membres inactifs (clock_in > 4h sans clock_out)
    const { rows: inactive } = await pool.query(`
      SELECT u.display_name, sc.clock_in FROM shift_clocks sc
      JOIN users u ON sc.user_id = u.id
      WHERE sc.clock_out IS NULL AND sc.clock_in < NOW() - INTERVAL '4 hours'
    `);

    // Membres absents (team members qui ne se sont pas pointés aujourd'hui)
    const { rows: absent } = await pool.query(`
      SELECT u.display_name FROM users u
      WHERE u.role IN ('chatter', 'outreach', 'va')
      AND u.id NOT IN (SELECT user_id FROM shift_clocks WHERE clock_in::date = CURRENT_DATE)
      AND u.id NOT IN (SELECT user_id FROM leave_requests WHERE status = 'approved' AND start_date <= $1 AND end_date >= $1)
    `, [todayStr]);

    let msg = `📊 RAPPORT QUOTIDIEN\n📅 ${new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `\n💰 REVENUS DU JOUR\n`;
    msg += `Total: $${totalRevenue.toFixed(2)}\n`;
    if (top3.length > 0) {
      msg += `\n🏆 TOP MODÈLES\n`;
      top3.forEach((m, i) => {
        const icons = ['🥇', '🥈', '🥉'];
        msg += `${icons[i]} ${m.model_name}: $${(parseFloat(m.ppv) + parseFloat(m.tips)).toFixed(2)}\n`;
      });
    }
    msg += `\n━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `\n📨 OUTREACH\n`;
    msg += `📩 Leads contactés: ${totalContacted}\n`;
    msg += `✅ Leads signés: ${totalSigned}\n`;
    msg += `💬 DMs envoyés: ${ls.dms_today}\n`;
    if (inactive.length > 0 || absent.length > 0) {
      msg += `\n━━━━━━━━━━━━━━━━━━━━\n`;
      msg += `\n⚠️ ÉQUIPE\n`;
      if (inactive.length > 0) msg += `🔴 Inactifs +4h: ${inactive.map(m => m.display_name).join(', ')}\n`;
      if (absent.length > 0) msg += `⬜ Absents: ${absent.map(m => m.display_name).join(', ')}\n`;
    }

    await sendWhatsApp(msg);
    console.log('Daily report sent');
  } catch(e) { console.log('Daily report error:', e.message); }
}

async function sendWeeklyReport() {
  if (!(await isNotifEnabled('notif_weekly_report'))) return;
  try {
    const now = new Date();
    const weekStart = new Date(now); weekStart.setDate(now.getDate() - 7);
    const prevWeekStart = new Date(now); prevWeekStart.setDate(now.getDate() - 14);
    const weekStartStr = weekStart.toISOString().split('T')[0];
    const prevWeekStartStr = prevWeekStart.toISOString().split('T')[0];
    const nowStr = now.toISOString().split('T')[0];

    // Revenue this week vs previous week
    const { rows: thisWeek } = await pool.query(
      "SELECT COALESCE(SUM(ppv_total + tips_total), 0) as total FROM chatter_shifts WHERE date >= $1 AND date < $2",
      [weekStartStr, nowStr]
    );
    const { rows: prevWeek } = await pool.query(
      "SELECT COALESCE(SUM(ppv_total + tips_total), 0) as total FROM chatter_shifts WHERE date >= $1 AND date < $2",
      [prevWeekStartStr, weekStartStr]
    );
    const thisTotal = parseFloat(thisWeek[0].total);
    const prevTotal = parseFloat(prevWeek[0].total);
    const evolution = prevTotal > 0 ? ((thisTotal - prevTotal) / prevTotal * 100).toFixed(1) : 'N/A';
    const evoIcon = thisTotal >= prevTotal ? '📈' : '📉';

    // Best model of the week
    const { rows: bestModel } = await pool.query(
      "SELECT model_name, SUM(ppv_total + tips_total) as total FROM chatter_shifts WHERE date >= $1 AND date < $2 GROUP BY model_name ORDER BY total DESC LIMIT 1",
      [weekStartStr, nowStr]
    );

    // Leads processed
    const { rows: weekLeads } = await pool.query(`
      SELECT COUNT(*) as total,
             COUNT(*) FILTER (WHERE status = 'signed') as signed
      FROM student_leads WHERE created_at >= $1
    `, [weekStart.toISOString()]);

    // Revenue objectives met
    const currentMonth = now.toISOString().slice(0, 7);
    const { rows: objectives } = await pool.query(
      "SELECT m.name, mro.target, mro.current FROM model_revenue_objectives mro JOIN models m ON mro.model_id = m.id WHERE mro.month = $1",
      [currentMonth]
    );
    const metCount = objectives.filter(o => parseFloat(o.current) >= parseFloat(o.target) && parseFloat(o.target) > 0).length;
    const totalObj = objectives.filter(o => parseFloat(o.target) > 0).length;

    let msg = `📋 RAPPORT HEBDOMADAIRE\n📅 Semaine du ${weekStart.toLocaleDateString('fr-FR')} au ${now.toLocaleDateString('fr-FR')}\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `\n💰 REVENUS\n`;
    msg += `Cette semaine: $${thisTotal.toFixed(2)}\n`;
    msg += `Semaine précédente: $${prevTotal.toFixed(2)}\n`;
    msg += `${evoIcon} Évolution: ${evolution === 'N/A' ? 'N/A' : (thisTotal >= prevTotal ? '+' : '') + evolution + '%'}\n`;
    if (bestModel.length > 0) {
      msg += `\n🏆 MEILLEUR MODÈLE\n`;
      msg += `${bestModel[0].model_name}: $${parseFloat(bestModel[0].total).toFixed(2)}\n`;
    }
    msg += `\n━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `\n📨 LEADS\n`;
    msg += `Total traités: ${weekLeads[0].total}\n`;
    msg += `Signés: ${weekLeads[0].signed}\n`;
    if (totalObj > 0) {
      msg += `\n━━━━━━━━━━━━━━━━━━━━\n`;
      msg += `\n🎯 OBJECTIFS\n`;
      msg += `Atteints: ${metCount}/${totalObj}\n`;
      objectives.filter(o => parseFloat(o.target) > 0).forEach(o => {
        const pct = (parseFloat(o.current) / parseFloat(o.target) * 100).toFixed(0);
        const icon = parseFloat(o.current) >= parseFloat(o.target) ? '✅' : '⏳';
        msg += `${icon} ${o.name}: ${pct}%\n`;
      });
    }

    await sendWhatsApp(msg);
    console.log('Weekly report sent');
  } catch(e) { console.log('Weekly report error:', e.message); }
}

async function checkRevenueObjectiveAlert(modelName, date) {
  if (!(await isNotifEnabled('notif_alert_revenue_objective'))) return;
  try {
    const currentMonth = date.slice(0, 7);
    const { rows } = await pool.query(`
      SELECT mro.target, mro.current, m.name FROM model_revenue_objectives mro
      JOIN models m ON mro.model_id = m.id
      WHERE m.name = $1 AND mro.month = $2 AND mro.target > 0
    `, [modelName, currentMonth]);
    if (rows.length === 0) return;
    const obj = rows[0];
    // Get today's revenue for this model
    const { rows: todayRev } = await pool.query(
      "SELECT COALESCE(SUM(ppv_total + tips_total), 0) as total FROM chatter_shifts WHERE model_name = $1 AND date = $2",
      [modelName, date]
    );
    const dailyTarget = parseFloat(obj.target) / 30;
    const todayTotal = parseFloat(todayRev[0].total);
    if (todayTotal > dailyTarget && dailyTarget > 0) {
      sendWhatsApp(`🚀 OBJECTIF DÉPASSÉ !\n\n💎 ${modelName} a dépassé son objectif journalier\n💰 Aujourd'hui: $${todayTotal.toFixed(2)} (objectif: $${dailyTarget.toFixed(2)}/jour)\n📊 Progression mois: $${parseFloat(obj.current).toFixed(2)}/$${parseFloat(obj.target).toFixed(2)}`);
    }
  } catch(e) {}
}

async function checkInactiveChatters() {
  if (!(await isNotifEnabled('notif_alert_inactive_chatter'))) return;
  try {
    const { rows } = await pool.query(`
      SELECT u.display_name, sc.clock_in,
        EXTRACT(EPOCH FROM (NOW() - sc.clock_in)) / 3600 as hours_in
      FROM shift_clocks sc
      JOIN users u ON sc.user_id = u.id
      WHERE sc.clock_out IS NULL
        AND sc.clock_in < NOW() - INTERVAL '2 hours'
        AND u.role = 'chatter'
    `);
    for (const chatter of rows) {
      // Check if we already sent an alert recently (check activity_log)
      const { rows: recent } = await pool.query(
        "SELECT id FROM activity_log WHERE action = 'inactive-chatter-alert' AND details = $1 AND created_at > NOW() - INTERVAL '4 hours'",
        [chatter.display_name]
      );
      if (recent.length === 0) {
        sendWhatsApp(`⚠️ CHATTER INACTIF\n\n👤 ${chatter.display_name}\n⏱️ Pointé depuis ${Math.round(chatter.hours_in)}h sans activité\n\nVérifie que tout va bien.`);
        await pool.query("INSERT INTO activity_log (user_name, action, target_type, details) VALUES ($1, 'inactive-chatter-alert', 'system', $1)", [chatter.display_name]);
      }
    }
  } catch(e) { console.log('Inactive chatter check error:', e.message); }
}

let dailyCronJob = null;
let weeklyCronJob = null;
let inactiveCheckJob = null;

async function setupCronJobs() {
  // Get configured daily report hour (default: 20:00 Paris time)
  const dailyHour = (await getNotifSetting('notif_daily_hour')) || '20:00';
  const [hour, minute] = dailyHour.split(':').map(Number);

  // Stop existing jobs
  if (dailyCronJob) dailyCronJob.stop();
  if (weeklyCronJob) weeklyCronJob.stop();
  if (inactiveCheckJob) inactiveCheckJob.stop();

  // Daily report - configurable time (default 20:00), timezone Europe/Paris
  dailyCronJob = cron.schedule(`${minute || 0} ${hour || 20} * * *`, () => {
    sendDailyReport();
  }, { timezone: 'Europe/Paris' });

  // Weekly report - Monday 9:00 AM Paris time
  weeklyCronJob = cron.schedule('0 9 * * 1', () => {
    sendWeeklyReport();
  }, { timezone: 'Europe/Paris' });

  // Check inactive chatters every 30 minutes
  inactiveCheckJob = cron.schedule('*/30 * * * *', () => {
    checkInactiveChatters();
  }, { timezone: 'Europe/Paris' });

  console.log(`Cron jobs configured: daily report at ${dailyHour} (Paris), weekly Monday 9h, inactive check every 30min`);
}


module.exports = { setupCronJobs, sendDailyReport, sendWeeklyReport };
