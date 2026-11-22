/* 輔英科技大學 3D 智慧水務 SCADA 系統 - 核心控制、用電評估、餘氯不足 ALARM 與數據管理引擎 */

document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  // ============================================================
  // 0. 內建備援範例 CSV (確保 file:// 本地直開也能完整運作)
  // ============================================================
  const EMBEDDED_SAMPLE_CSV = `Timestamp,Sedimentation_pH,Sedimentation_ORP,CleanWater_pH,CleanWater_ORP,CleanWater_Level,Pump_A_Status,Pump_B_Status,Dosing_Pump_Status,Free_Chlorine_DPD_mgL,Air_Clean_Pulse,Alarm_Status,Notes
2026-09-01 00:00:00,7.12,485,7.35,710,NORMAL,RUNNING,STOPPED,RUNNING,0.58,0,NORMAL,常態運轉
2026-09-01 01:00:00,7.10,482,7.34,708,NORMAL,RUNNING,STOPPED,RUNNING,0.56,0,NORMAL,常態運轉
2026-09-01 02:00:00,7.15,488,7.36,715,HIGH,STOPPED,STOPPED,STOPPED,0.60,0,NORMAL,滿水停泵
2026-09-01 03:00:00,7.18,490,7.38,712,NORMAL,STOPPED,STOPPED,STOPPED,0.59,0,NORMAL,水位維持
2026-09-01 04:00:00,7.14,486,7.35,710,NORMAL,STOPPED,STOPPED,STOPPED,0.58,1,NORMAL,電極自動空氣清洗脈衝
2026-09-01 05:00:00,7.11,480,7.33,705,LOW,STOPPED,RUNNING,RUNNING,0.55,0,NORMAL,水位偏低交替輪換啟動Pump B
2026-09-01 06:00:00,7.09,478,7.32,702,NORMAL,STOPPED,RUNNING,RUNNING,0.54,0,NORMAL,常態加氯過濾
2026-09-01 07:00:00,7.13,484,7.35,711,NORMAL,STOPPED,RUNNING,RUNNING,0.57,0,NORMAL,常態加氯過濾
2026-09-01 08:00:00,7.16,489,7.37,716,HIGH,STOPPED,STOPPED,STOPPED,0.61,0,NORMAL,水位於上限自動停泵
2026-09-01 09:00:00,7.15,487,7.36,714,NORMAL,STOPPED,STOPPED,STOPPED,0.60,0,NORMAL,人工DPD採樣對比校正
2026-09-01 10:00:00,6.85,420,7.28,640,LOW,RUNNING,STOPPED,RUNNING,0.32,0,ALARM_LOW_ORP,暴雨原水有機物上升導致ORP下降警報
2026-09-01 11:00:00,6.92,445,7.31,675,NORMAL,RUNNING,STOPPED,RUNNING,0.42,0,NORMAL,提高投藥後ORP恢復正常
2026-09-01 12:00:00,7.10,480,7.34,708,NORMAL,RUNNING,STOPPED,RUNNING,0.56,0,NORMAL,系統穩定`;

  const EMBEDDED_ALARM_TEST_CSV = `Timestamp,Sedimentation_pH,Sedimentation_ORP,CleanWater_pH,CleanWater_ORP,CleanWater_Level,Pump_A_Status,Pump_B_Status,Dosing_Pump_Status,Free_Chlorine_DPD_mgL,Air_Clean_Pulse,Alarm_Status,Notes
2026-09-10 08:00:00,7.15,486,7.35,712,NORMAL,RUNNING,STOPPED,RUNNING,0.59,0,NORMAL,晨間常態供水
2026-09-10 09:00:00,7.02,455,7.30,668,NORMAL,RUNNING,STOPPED,RUNNING,0.44,0,NORMAL,豪雨初期原水濁度上升
2026-09-10 10:00:00,6.82,395,7.25,605,LOW,RUNNING,STOPPED,RUNNING,0.28,0,WARNING_LOW_CL2,餘氯逼近下限警戒 (0.28 mg/L)
2026-09-10 11:00:00,6.68,360,7.22,535,LOW,RUNNING,STOPPED,STOPPED,0.17,0,ALARM_CRITICAL_LOW_CL2,加藥桶管路氣鎖導致餘氯嚴重不足 ALARM!
2026-09-10 12:00:00,6.75,380,7.24,520,NORMAL,STOPPED,RUNNING,RUNNING,0.16,0,ALARM_CRITICAL_LOW_CL2,觸發聯鎖補氯並切換砂濾泵 B
2026-09-10 13:00:00,6.90,430,7.29,635,NORMAL,STOPPED,RUNNING,RUNNING,0.35,0,NORMAL,補氯發揮效用，餘氯回升至安全區
2026-09-10 14:00:00,7.10,478,7.34,706,HIGH,STOPPED,STOPPED,STOPPED,0.57,1,NORMAL,水質完全恢復並執行電極空氣清洗`;

  // ============================================================
  // 1. 全域系統狀態 Global State
  // ============================================================
  const state = {
    ctrlMode: 'AUTO', // 'AUTO' | 'MANUAL'
    sedimentationPh: 7.14,
    sedimentationOrp: 485,
    cleanWaterPh: 7.35,
    cleanWaterOrp: 710,
    freeChlorine: 0.58,
    dosingGainPct: 100,
    cleanWaterLevel: 'NORMAL', // 'NORMAL' | 'LOW' | 'HIGH'
    pumpAStatus: 'RUNNING',
    pumpBStatus: 'STOPPED',
    dosingPumpStatus: 'RUNNING',
    airCleanPulse: false,
    hoursPumpA: 142.5,
    hoursPumpB: 139.2,
    lastActivePump: 'A',
    autoAlternateEnabled: true,
    autoAlternateSec: 12,
    isModbusStreaming: true,

    // 餘氯不足 ALARM 告警系統狀態
    alarmConfig: {
      warnLowCl: 0.30,
      critLowCl: 0.20,
      highCl: 1.00,
      lowOrp: 650,
      soundEnabled: true,
      autoInterlock: true
    },
    alarmState: {
      severity: 'NORMAL', // 'NORMAL' | 'WARNING' | 'CRITICAL'
      code: 'OK',
      title: '目前狀態：餘氯正常',
      detail: '自由餘氯與 ORP 皆符合飲用水法規標準',
      acknowledged: false,
      lastLoggedKey: '',
      history: []
    },

    // 各單元用電量評估參數
    energyConfig: {
      tariffRate: 3.85,
      pumpDailyHours: 14,
      carbonFactor: 0.494
    },
    energySummary: {
      totalKw: 3.98,
      dailyKwh: 58.4,
      monthlyCost: 6745,
      monthlyCo2: 865,
      annualSavingNtd: 32000,
      units: []
    },

    // 數據匯入與回放狀態
    importedData: [],
    replay: {
      active: false,
      paused: false,
      index: 0,
      timer: null
    },

    // NIEA 迴歸數據
    dpdLabData: [
      { chlorine: 0.25, orp: 610 },
      { chlorine: 0.40, orp: 660 },
      { chlorine: 0.58, orp: 710 },
      { chlorine: 0.75, orp: 750 },
      { chlorine: 0.90, orp: 785 }
    ]
  };

  // ============================================================
  // 2. Web Audio API 工業蜂鳴器警報引擎 (免外部音效檔)
  // ============================================================
  let audioCtx = null;
  let lastBeepTs = 0;

  function playAlarmBeep(isCritical) {
    if (!state.alarmConfig.soundEnabled || state.alarmState.acknowledged) return;
    const nowMs = Date.now();
    const cooldown = isCritical ? 2400 : 4500;
    if (nowMs - lastBeepTs < cooldown) return;
    lastBeepTs = nowMs;

    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtx) audioCtx = new Ctx();
      if (audioCtx.state === 'suspended') audioCtx.resume();

      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = isCritical ? 'sawtooth' : 'sine';
      const now = audioCtx.currentTime;
      osc.frequency.setValueAtTime(isCritical ? 880 : 620, now);
      if (isCritical) {
        osc.frequency.setValueAtTime(660, now + 0.16);
        osc.frequency.setValueAtTime(880, now + 0.32);
      }
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.48);

      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.5);
    } catch (e) {
      // Browser autoplay policy may block until user interaction
    }
  }

  // ============================================================
  // 3. 初始化 Three.js 3D 數位孿生管理器
  // ============================================================
  if (window.Water3DManager) {
    window.Water3DManager.init();
  }

  // ============================================================
  // 4. 分頁切換 Tab Navigation
  // ============================================================
  const tabs = document.querySelectorAll('.nav-tab');
  const panels = document.querySelectorAll('.tab-panel');

  function switchToTab(tabId) {
    tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tabId));
    panels.forEach(p => p.classList.toggle('active', p.id === tabId));

    if (window.Water3DManager) {
      window.Water3DManager.setActiveTab(tabId);
    }

    if (tabId === 'tab-chlorine-game') {
      renderChlorineGameChart();
      renderPhSpeciationChart();
      setTimeout(() => {
        if (chartChlorineInstance) chartChlorineInstance.resize();
        if (chartPhSpeciationInstance) chartPhSpeciationInstance.resize();
      }, 60);
    } else if (tabId === 'tab-energy') {
      renderEnergyCharts();
    } else if (tabId === 'tab-data-qc') {
      renderLongTermChart();
    } else if (tabId === 'tab-education') {
      renderRegressionChart();
    }
  }

  tabs.forEach(tab => {
    tab.addEventListener('click', () => switchToTab(tab.dataset.tab));
  });

  // 3D Camera preset buttons
  document.querySelectorAll('.scada-cam-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.scada-cam-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      window.Water3DManager?.setScadaCamera(btn.dataset.cam);
    });
  });

  document.querySelectorAll('.cl3d-cam-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.cl3d-cam-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      window.Water3DManager?.setChlorineCamera(btn.dataset.cam);
    });
  });

  // Header Alarm Pill jump
  document.getElementById('header-alarm-pill')?.addEventListener('click', () => {
    switchToTab('tab-scada');
    document.getElementById('scada-alarm-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  // ============================================================
  // 5. 即時時鐘與餘氯換算 (DPD 對數迴歸)
  // ============================================================
  function getTimeString(date = new Date()) {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
  }

  function getDateTimeString(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${getTimeString(date)}`;
  }

  function updateClock() {
    const el = document.getElementById('current-time');
    if (el) el.textContent = getDateTimeString();
  }
  setInterval(updateClock, 1000);
  updateClock();

  function calculateFreeChlorine(orp) {
    const cl = Math.exp((orp - 788.4) / 145.2);
    return Math.max(0.05, Math.min(2.2, parseFloat(cl.toFixed(2))));
  }

  // ============================================================
  // 6. 事件日誌系統 Event Logger
  // ============================================================
  function addEventLog(type, msg) {
    const container = document.getElementById('event-log-container');
    if (!container) return;

    const timeStr = getTimeString();
    let hexTag = '<span style="color:#4ade80;">INFO</span>';
    if (type === 'ALARM') hexTag = '<span style="color:#ef4444; font-weight:800;">ALARM</span>';
    else if (type === 'WARN') hexTag = '<span style="color:#f59e0b; font-weight:700;">WARN</span>';
    else if (type === 'AUTO_LOGIC') hexTag = '<span style="color:#38bdf8; font-weight:700;">AUTO</span>';
    else if (type === 'AIR_CLEAN') hexTag = '<span style="color:#00f2fe; font-weight:700;">AIR_CLN</span>';
    else if (type === 'REPLAY') hexTag = '<span style="color:#c084fc; font-weight:700;">REPLAY</span>';

    const line = document.createElement('div');
    line.className = 'modbus-line';
    line.innerHTML = `<span class="modbus-time">[${timeStr}]</span> <span class="modbus-hex">${hexTag}</span> <span class="modbus-desc">${msg}</span>`;
    container.insertBefore(line, container.firstChild);
    while (container.children.length > 60) {
      container.removeChild(container.lastChild);
    }
  }

  // ============================================================
  // 7. 各單元系統用電量評估引擎 (Unit-Level Energy Assessment)
  // ============================================================
  let chartEnergyPieInstance = null;
  let chartEnergy24hInstance = null;

  function evaluateUnitEnergy() {
    const cfg = state.energyConfig;
    const pumpAOn = state.pumpAStatus === 'RUNNING';
    const pumpBOn = state.pumpBStatus === 'RUNNING';
    const doseOn = state.dosingPumpStatus === 'RUNNING';
    const airOn = state.airCleanPulse;
    const anyPump = pumpAOn || pumpBOn;

    const doseFactor = Math.max(0.4, state.dosingGainPct / 100);
    const units = [
      {
        key: 'pumpA',
        name: '砂濾泵 A (3HP 主過濾)',
        status: pumpAOn ? '運轉中' : '待機',
        ratedKw: 2.20,
        liveKw: pumpAOn ? 2.20 : 0.02,
        pf: 0.86,
        dailyHours: cfg.pumpDailyHours * 0.52,
        color: '#00f2fe'
      },
      {
        key: 'pumpB',
        name: '砂濾泵 B (3HP 交替備援)',
        status: pumpBOn ? '運轉中' : '待機',
        ratedKw: 2.20,
        liveKw: pumpBOn ? 2.20 : 0.02,
        pf: 0.86,
        dailyHours: cfg.pumpDailyHours * 0.48,
        color: '#38bdf8'
      },
      {
        key: 'rawIntake',
        name: '原水抽水 / 沉澱池進水單元',
        status: anyPump ? '連動運轉' : '低載待機',
        ratedKw: 1.50,
        liveKw: anyPump ? 1.50 : 0.12,
        pf: 0.88,
        dailyHours: cfg.pumpDailyHours,
        color: '#3b82f6'
      },
      {
        key: 'dosing',
        name: '次氯酸鈉 NaOCl 加藥泵',
        status: doseOn ? `投藥中 (${state.dosingGainPct}%)` : '停止',
        ratedKw: 0.18,
        liveKw: doseOn ? parseFloat((0.18 * doseFactor).toFixed(3)) : 0.01,
        pf: 0.90,
        dailyHours: cfg.pumpDailyHours,
        color: '#f59e0b'
      },
      {
        key: 'airClean',
        name: '12VDC 電極空氣清洗泵',
        status: airOn ? '脈衝噴氣中' : '休眠待機',
        ratedKw: 0.12,
        liveKw: airOn ? 0.12 : 0.0,
        pf: 0.92,
        dailyHours: 0.5,
        color: '#10b981'
      },
      {
        key: 'iotControl',
        name: 'DO4 Smart Box + 2×RS485 HUB + SCADA',
        status: '24H 持續監測',
        ratedKw: 0.085,
        liveKw: 0.085,
        pf: 0.95,
        dailyHours: 24,
        color: '#a855f7'
      }
    ];

    let totalLiveKw = 0;
    let totalDailyKwh = 0;

    units.forEach(u => {
      u.dailyKwh = parseFloat((u.ratedKw * u.dailyHours + (24 - u.dailyHours) * 0.01).toFixed(2));
      u.monthlyKwh = u.dailyKwh * 30;
      u.monthlyCost = Math.round(u.monthlyKwh * cfg.tariffRate);
      u.monthlyCo2 = parseFloat((u.monthlyKwh * cfg.carbonFactor).toFixed(1));
      totalLiveKw += u.liveKw;
      totalDailyKwh += u.dailyKwh;
    });

    units.forEach(u => {
      u.sharePct = totalDailyKwh > 0 ? parseFloat(((u.dailyKwh / totalDailyKwh) * 100).toFixed(1)) : 0;
    });

    // Baseline comparison (legacy 24h non-automated single-speed operation)
    const legacyDailyKwh = (2.20 * 18.5) + (1.50 * 18.5) + (0.18 * 18.5) + (0.085 * 24);
    const savingPct = Math.max(0, parseFloat((((legacyDailyKwh - totalDailyKwh) / legacyDailyKwh) * 100).toFixed(1)));
    const annualSavingNtd = Math.max(0, Math.round((legacyDailyKwh - totalDailyKwh) * 365 * cfg.tariffRate));

    state.energySummary = {
      totalKw: parseFloat(totalLiveKw.toFixed(2)),
      dailyKwh: parseFloat(totalDailyKwh.toFixed(1)),
      monthlyCost: Math.round(totalDailyKwh * 30 * cfg.tariffRate),
      monthlyCo2: Math.round(totalDailyKwh * 30 * cfg.carbonFactor),
      savingPct,
      annualSavingNtd,
      units
    };

    // Sync Header & SCADA KPIs
    const hdrKw = document.getElementById('header-live-kw');
    const scadaKw = document.getElementById('val-scada-kw');
    const scadaKwh = document.getElementById('val-scada-daily-kwh');
    if (hdrKw) hdrKw.textContent = state.energySummary.totalKw.toFixed(2);
    if (scadaKw) scadaKw.innerHTML = `${state.energySummary.totalKw.toFixed(2)} <span class="metric-unit">kW</span>`;
    if (scadaKwh) scadaKwh.textContent = state.energySummary.dailyKwh.toFixed(1);

    // Sync Relay kW badges in Tab 1
    const r1 = document.getElementById('relay1-kw');
    const r2 = document.getElementById('relay2-kw');
    const r3 = document.getElementById('relay3-kw');
    const r4 = document.getElementById('relay4-kw');
    if (r1) r1.textContent = `${units[0].liveKw.toFixed(2)} kW`;
    if (r2) r2.textContent = `${units[1].liveKw.toFixed(2)} kW`;
    if (r3) r3.textContent = `${units[3].liveKw.toFixed(2)} kW`;
    if (r4) r4.textContent = `${units[4].liveKw.toFixed(2)} kW`;

    // Sync Tab 3 KPIs
    const engTotal = document.getElementById('eng-total-kw');
    const engDaily = document.getElementById('eng-daily-kwh');
    const engCost = document.getElementById('eng-monthly-cost');
    const engCo2 = document.getElementById('eng-monthly-co2');
    const engSave = document.getElementById('eng-saving-pct');
    if (engTotal) engTotal.innerHTML = `${state.energySummary.totalKw.toFixed(2)} <span class="metric-unit">kW</span>`;
    if (engDaily) engDaily.innerHTML = `${state.energySummary.dailyKwh.toFixed(1)} <span class="metric-unit">kWh/日</span>`;
    if (engCost) engCost.textContent = `NT$ ${state.energySummary.monthlyCost.toLocaleString()}`;
    if (engCo2) engCo2.innerHTML = `${state.energySummary.monthlyCo2.toLocaleString()} <span class="metric-unit">kg CO₂e</span>`;
    if (engSave) engSave.innerHTML = `${state.energySummary.savingPct.toFixed(1)} <span class="metric-unit">%</span>`;

    // Render Table
    const tbody = document.getElementById('table-energy-units-body');
    if (tbody) {
      tbody.innerHTML = units.map(u => {
        const activeClass = u.liveKw > 0.05 ? 'green' : '';
        return `
          <tr>
            <td><strong>${u.name}</strong></td>
            <td><span class="status-badge ${activeClass}" style="font-size:0.72rem;">${u.status}</span></td>
            <td style="font-family:var(--font-code);">${u.ratedKw.toFixed(3)}</td>
            <td style="font-family:var(--font-code); color:${u.liveKw > 0.05 ? '#00f2fe' : '#64748b'}; font-weight:700;">${u.liveKw.toFixed(3)}</td>
            <td style="font-family:var(--font-code);">${u.pf.toFixed(2)}</td>
            <td style="font-family:var(--font-code);">${u.dailyHours.toFixed(1)} h</td>
            <td style="font-family:var(--font-code);">${u.dailyKwh.toFixed(2)}</td>
            <td style="font-family:var(--font-code); color:#fbbf24;">NT$ ${u.monthlyCost.toLocaleString()}</td>
            <td style="font-family:var(--font-code);">${u.monthlyCo2}</td>
            <td>
              <div style="display:flex; align-items:center; gap:0.45rem;">
                <div class="energy-bar-track"><div class="energy-bar-fill" style="width:${u.sharePct}%; background:${u.color};"></div></div>
                <span style="font-size:0.74rem; font-family:var(--font-code); width:40px;">${u.sharePct}%</span>
              </div>
            </td>
          </tr>
        `;
      }).join('');
    }

    // Sync 3D Energy Scene
    window.Water3DManager?.syncEnergy(units);
  }

  function renderEnergyCharts() {
    const units = state.energySummary.units;
    if (!units.length) return;

    const pieCtx = document.getElementById('chartEnergyPie');
    if (pieCtx) {
      if (chartEnergyPieInstance) chartEnergyPieInstance.destroy();
      chartEnergyPieInstance = new Chart(pieCtx, {
        type: 'doughnut',
        data: {
          labels: units.map(u => u.name.split(' ')[0]),
          datasets: [{
            data: units.map(u => u.dailyKwh),
            backgroundColor: units.map(u => u.color),
            borderColor: '#0b1222',
            borderWidth: 2
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'right', labels: { color: '#cbd5e1', font: { size: 10 }, boxWidth: 10 } }
          }
        }
      });
    }

    const barCtx = document.getElementById('chartEnergy24h');
    if (barCtx) {
      if (chartEnergy24hInstance) chartEnergy24hInstance.destroy();
      const hrs = ['00h', '03h', '06h', '09h', '12h', '15h', '18h', '21h'];
      const ratio = state.energyConfig.pumpDailyHours / 14;
      const smartLoad = [0.25, 0.28, 3.95, 4.02, 3.98, 2.15, 3.95, 1.85].map(v => parseFloat((v * ratio).toFixed(2)));
      const legacyLoad = [3.95, 3.95, 4.10, 4.10, 4.10, 4.05, 4.10, 3.95];

      chartEnergy24hInstance = new Chart(barCtx, {
        type: 'line',
        data: {
          labels: hrs,
          datasets: [
            { label: '智慧雙泵交替負載 (kW)', data: smartLoad, borderColor: '#00f2fe', backgroundColor: 'rgba(0,242,254,0.14)', fill: true, tension: 0.35 },
            { label: '傳統無控管基準 (kW)', data: legacyLoad, borderColor: '#f59e0b', borderDash: [5, 4], backgroundColor: 'transparent', tension: 0.2 }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { labels: { color: '#cbd5e1', font: { size: 10 } } } },
          scales: {
            x: { ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
            y: { ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.06)' }, min: 0 }
          }
        }
      });
    }
  }

  ['eng-tariff-rate', 'eng-pump-hours', 'eng-carbon-factor'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => {
      state.energyConfig.tariffRate = parseFloat(document.getElementById('eng-tariff-rate')?.value) || 3.85;
      state.energyConfig.pumpDailyHours = parseFloat(document.getElementById('eng-pump-hours')?.value) || 14;
      state.energyConfig.carbonFactor = parseFloat(document.getElementById('eng-carbon-factor')?.value) || 0.494;
      evaluateUnitEnergy();
      renderEnergyCharts();
    });
  });

  document.getElementById('btn-sync-energy-sroi')?.addEventListener('click', () => {
    const chemSaving = 65000;
    const totalSaving = state.energySummary.annualSavingNtd + chemSaving;
    const el = document.getElementById('sroi-input-savings');
    if (el) {
      el.value = totalSaving;
      const preset = document.getElementById('sroi-preset-select');
      if (preset) preset.value = 'custom';
      calculateSROI();
      addEventLog('INFO', `已將各單元年節電效益 (NT$ ${state.energySummary.annualSavingNtd.toLocaleString()}) 同步至 SROI 計算器！`);
      switchToTab('tab-education');
    }
  });

  document.getElementById('btn-export-energy-csv')?.addEventListener('click', () => {
    const header = '單元名稱,運轉狀態,額定功率(kW),即時功率(kW),功率因數,日運轉時數(h),預估日耗電(kWh),預估月電費(NTD),月碳排(kgCO2e),耗電佔比(%)\n';
    const body = state.energySummary.units.map(u =>
      `${u.name},${u.status},${u.ratedKw},${u.liveKw},${u.pf},${u.dailyHours.toFixed(1)},${u.dailyKwh},${u.monthlyCost},${u.monthlyCo2},${u.sharePct}`
    ).join('\n');
    downloadTextFile('\uFEFF' + header + body, 'Fooyin_Unit_Energy_Assessment_2026.csv', 'text/csv;charset=utf-8;');
  });

  // ============================================================
  // 8. 餘氯不足 ALARM 告警系統引擎 (Low Residual Chlorine ALARM)
  // ============================================================
  function evaluateChlorineAlarm() {
    const cl = state.freeChlorine;
    const orp = state.cleanWaterOrp;
    const cfg = state.alarmConfig;
    const a = state.alarmState;

    let severity = 'NORMAL';
    let code = 'OK';
    let title = '目前狀態：餘氯正常合規';
    let detail = `自由餘氯 ${cl.toFixed(2)} mg/L | ORP ${Math.round(orp)} mV (符合 0.2~1.0 mg/L)`;
    let interlockMsg = '無須動作';

    if (cl < cfg.critLowCl) {
      severity = 'CRITICAL';
      code = 'LOW_CL2_CRITICAL';
      title = '🚨 餘氯嚴重不足緊急警報 (CRITICAL LOW Cl₂)';
      detail = `清水池自由餘氯僅 ${cl.toFixed(2)} mg/L (< 法規下限 ${cfg.critLowCl.toFixed(2)} mg/L)，ORP ${Math.round(orp)} mV，大腸桿菌風險極高！`;
      if (cfg.autoInterlock && state.ctrlMode === 'AUTO') {
        state.dosingPumpStatus = 'RUNNING';
        state.dosingGainPct = 140;
        const gainSlider = document.getElementById('slider-scada-dosing-gain');
        if (gainSlider) gainSlider.value = 140;
        const gainVal = document.getElementById('slider-val-dosing-gain');
        if (gainVal) gainVal.textContent = '140%';
        interlockMsg = 'AUTO 自動聯鎖：強制開啟加藥泵 (140% 緊急補氯)';
      } else {
        interlockMsg = '等待現場操作員手動補氯';
      }
    } else if (cl < cfg.warnLowCl || orp < cfg.lowOrp) {
      severity = 'WARNING';
      code = 'LOW_CL2_WARNING';
      title = '⚠️ 餘氯偏低 / ORP 警戒警報 (WARNING LOW Cl₂)';
      detail = `自由餘氯 ${cl.toFixed(2)} mg/L (警戒值 ${cfg.warnLowCl.toFixed(2)} mg/L)，ORP ${Math.round(orp)} mV (下限 ${cfg.lowOrp} mV)`;
      if (cfg.autoInterlock && state.ctrlMode === 'AUTO') {
        state.dosingPumpStatus = 'RUNNING';
        if (state.dosingGainPct < 120) state.dosingGainPct = 120;
        interlockMsg = 'AUTO 自動聯鎖：提升加藥出力至 120%';
      } else {
        interlockMsg = '建議檢查 NaOCl 藥桶液位與加藥泵';
      }
    } else if (cl > cfg.highCl) {
      severity = 'WARNING';
      code = 'HIGH_CL2_WARNING';
      title = '☣️ 餘氯過高警報 (HIGH Cl₂ / THMs 風險)';
      detail = `自由餘氯 ${cl.toFixed(2)} mg/L 超過法規上限 ${cfg.highCl.toFixed(2)} mg/L，請調降加藥量！`;
      interlockMsg = '建議調降加藥出力或啟動脫氯中和';
    }

    // Detect state transition for Alarm Audit Log
    if (severity !== 'NORMAL' && a.lastLoggedKey !== `${code}`) {
      a.acknowledged = false;
      a.lastLoggedKey = `${code}`;
      a.history.unshift({
        time: getDateTimeString(),
        severity,
        type: code === 'LOW_CL2_CRITICAL' ? '餘氯嚴重不足' : code === 'LOW_CL2_WARNING' ? '餘氯/ORP 偏低警戒' : '餘氯過高超標',
        values: `${cl.toFixed(2)} mg/L / ${Math.round(orp)} mV`,
        interlock: interlockMsg,
        status: 'ACTIVE (觸發中)'
      });
      if (a.history.length > 40) a.history.pop();
      addEventLog(severity === 'CRITICAL' ? 'ALARM' : 'WARN', `${title} — ${detail} [${interlockMsg}]`);
      renderAlarmHistoryTable();
    } else if (severity === 'NORMAL' && a.severity !== 'NORMAL') {
      a.lastLoggedKey = '';
      a.acknowledged = false;
      if (a.history.length && a.history[0].status.startsWith('ACTIVE')) {
        a.history[0].status = 'CLEARED (已恢復)';
      }
      addEventLog('AUTO_LOGIC', `✅ 餘氯警報解除：目前自由餘氯 ${cl.toFixed(2)} mg/L、ORP ${Math.round(orp)} mV 已恢復安全範圍。`);
      renderAlarmHistoryTable();
    }

    a.severity = severity;
    a.code = code;
    a.title = title;
    a.detail = detail;

    // Audible beep if active and not acknowledged
    if (severity !== 'NORMAL') {
      playAlarmBeep(severity === 'CRITICAL');
    }

    // Update Banner, Header Pill, Lamp & Body Border
    const banner = document.getElementById('global-alarm-banner');
    const bannerTitle = document.getElementById('global-alarm-title');
    const bannerDesc = document.getElementById('global-alarm-desc');
    const pill = document.getElementById('header-alarm-pill');
    const pillText = document.getElementById('header-alarm-text');
    const lamp = document.getElementById('alarm-lamp');
    const stateBadge = document.getElementById('alarm-state-text');
    const logBadge = document.getElementById('badge-log-count');

    document.body.classList.toggle('alarm-critical-active', severity === 'CRITICAL' && !a.acknowledged);

    if (banner) {
      banner.classList.toggle('active', severity !== 'NORMAL');
      banner.classList.toggle('warning-mode', severity === 'WARNING');
      banner.classList.toggle('acknowledged', a.acknowledged);
    }
    if (bannerTitle) bannerTitle.textContent = a.acknowledged ? `${title} [已確認消音]` : title;
    if (bannerDesc) bannerDesc.textContent = detail;

    if (pill && pillText) {
      pill.classList.toggle('alarm-active', severity !== 'NORMAL');
      pillText.textContent = severity === 'CRITICAL' ? '餘氯不足緊急!' : severity === 'WARNING' ? '餘氯警戒' : '正常合規';
    }

    if (lamp) {
      lamp.className = 'alarm-status-lamp' + (severity === 'CRITICAL' ? ' critical' : severity === 'WARNING' ? ' warning' : '');
    }
    if (stateBadge) {
      stateBadge.className = 'badge-status ' + (severity === 'CRITICAL' ? 'red' : severity === 'WARNING' ? 'amber' : 'green');
      stateBadge.textContent = severity === 'CRITICAL' ? '🚨 餘氯嚴重不足警報中' : severity === 'WARNING' ? '⚠️ 餘氯警戒中' : '目前狀態：餘氯正常';
    }
    if (logBadge) {
      logBadge.className = 'status-badge ' + (severity === 'CRITICAL' ? 'red' : severity === 'WARNING' ? 'amber' : 'green');
      logBadge.textContent = severity === 'NORMAL' ? '運轉正常' : 'ALARM 觸發中';
    }
  }

  function renderAlarmHistoryTable() {
    const tbody = document.getElementById('table-alarm-history-body');
    if (!tbody) return;
    if (!state.alarmState.history.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#64748b;">尚無警報觸發紀錄，系統消毒防護正常。</td></tr>';
      return;
    }
    tbody.innerHTML = state.alarmState.history.map(item => `
      <tr class="${item.severity === 'CRITICAL' ? 'row-alarm' : ''}">
        <td style="font-family:var(--font-code);">${item.time}</td>
        <td><span class="badge-status ${item.severity === 'CRITICAL' ? 'red' : 'amber'}">${item.severity}</span></td>
        <td><strong>${item.type}</strong></td>
        <td style="font-family:var(--font-code);">${item.values}</td>
        <td>${item.interlock}</td>
        <td><strong style="color:${item.status.includes('CLEARED') ? '#34d399' : item.status.includes('ACK') ? '#fbbf24' : '#f87171'};">${item.status}</strong></td>
      </tr>
    `).join('');
  }

  function acknowledgeAlarm() {
    state.alarmState.acknowledged = true;
    if (state.alarmState.history.length && state.alarmState.history[0].status.startsWith('ACTIVE')) {
      state.alarmState.history[0].status = 'ACK (已確認消音)';
      renderAlarmHistoryTable();
    }
    addEventLog('INFO', '操作員已確認並消音當前餘氯警報 (ALARM Acknowledged)。');
    evaluateChlorineAlarm();
  }

  function triggerEmergencyDosing() {
    state.dosingPumpStatus = 'RUNNING';
    state.dosingGainPct = 150;
    const gainSlider = document.getElementById('slider-scada-dosing-gain');
    if (gainSlider) gainSlider.value = 150;
    const gainVal = document.getElementById('slider-val-dosing-gain');
    if (gainVal) gainVal.textContent = '150%';
    state.cleanWaterOrp = Math.min(720, state.cleanWaterOrp + 65);
    addEventLog('AUTO_LOGIC', '🚀 執行一鍵緊急補氯：次氯酸鈉加藥泵全速 150% 投藥救援！');
    syncUI();
  }

  // Alarm Config Listeners
  ['cfg-alarm-warn-low', 'cfg-alarm-crit-low', 'cfg-alarm-high', 'cfg-alarm-orp-low'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => {
      state.alarmConfig.warnLowCl = parseFloat(document.getElementById('cfg-alarm-warn-low')?.value) || 0.30;
      state.alarmConfig.critLowCl = parseFloat(document.getElementById('cfg-alarm-crit-low')?.value) || 0.20;
      state.alarmConfig.highCl = parseFloat(document.getElementById('cfg-alarm-high')?.value) || 1.00;
      state.alarmConfig.lowOrp = parseFloat(document.getElementById('cfg-alarm-orp-low')?.value) || 650;
      evaluateChlorineAlarm();
    });
  });

  document.getElementById('cfg-alarm-sound')?.addEventListener('change', (e) => {
    state.alarmConfig.soundEnabled = e.target.checked;
    const btnMute = document.getElementById('btn-banner-mute');
    if (btnMute) btnMute.innerHTML = state.alarmConfig.soundEnabled ? '<i class="fa-solid fa-volume-high"></i> 警報音：開啟' : '<i class="fa-solid fa-volume-xmark"></i> 警報音：靜音';
  });

  document.getElementById('cfg-alarm-interlock')?.addEventListener('change', (e) => {
    state.alarmConfig.autoInterlock = e.target.checked;
    addEventLog('INFO', `餘氯不足自動聯鎖補氯已切換為：${e.target.checked ? '啟用' : '停用'}`);
  });

  document.getElementById('btn-banner-mute')?.addEventListener('click', () => {
    state.alarmConfig.soundEnabled = !state.alarmConfig.soundEnabled;
    const chk = document.getElementById('cfg-alarm-sound');
    if (chk) chk.checked = state.alarmConfig.soundEnabled;
    const btnMute = document.getElementById('btn-banner-mute');
    if (btnMute) btnMute.innerHTML = state.alarmConfig.soundEnabled ? '<i class="fa-solid fa-volume-high"></i> 警報音：開啟' : '<i class="fa-solid fa-volume-xmark"></i> 警報音：靜音';
  });

  document.getElementById('btn-banner-ack')?.addEventListener('click', acknowledgeAlarm);
  document.getElementById('btn-ack-alarm')?.addEventListener('click', acknowledgeAlarm);
  document.getElementById('btn-banner-emergency-dose')?.addEventListener('click', triggerEmergencyDosing);

  document.getElementById('btn-test-low-cl-alarm')?.addEventListener('click', () => {
    // Temporarily switch to manual or simulate dosing failure so alarm stays clearly visible for testing
    state.sedimentationOrp = 365;
    state.cleanWaterOrp = 535; // => ~0.17 mg/L (< 0.20 critical)
    state.dosingPumpStatus = 'STOPPED';
    state.ctrlMode = 'MANUAL';
    updateModeButtonsUI();
    state.alarmState.acknowledged = false;
    state.alarmState.lastLoggedKey = '';
    const sOrp = document.getElementById('slider-orp');
    if (sOrp) sOrp.value = 365;
    const vOrp = document.getElementById('slider-val-orp');
    if (vOrp) vOrp.textContent = '365 mV';
    syncUI();
  });

  document.getElementById('btn-reset-normal-water')?.addEventListener('click', () => {
    state.sedimentationPh = 7.14;
    state.sedimentationOrp = 485;
    state.cleanWaterPh = 7.35;
    state.cleanWaterOrp = 710;
    state.dosingGainPct = 100;
    state.ctrlMode = 'AUTO';
    state.pumpAStatus = 'RUNNING';
    state.pumpBStatus = 'STOPPED';
    state.dosingPumpStatus = 'RUNNING';
    updateModeButtonsUI();
    const sPh = document.getElementById('slider-ph');
    const sOrp = document.getElementById('slider-orp');
    const sGain = document.getElementById('slider-scada-dosing-gain');
    if (sPh) sPh.value = 7.14;
    if (sOrp) sOrp.value = 485;
    if (sGain) sGain.value = 100;
    document.getElementById('slider-val-ph').textContent = '7.14 pH';
    document.getElementById('slider-val-orp').textContent = '485 mV';
    document.getElementById('slider-val-dosing-gain').textContent = '100%';
    syncUI();
  });

  document.getElementById('btn-export-alarm-csv')?.addEventListener('click', () => {
    const header = '發生時間,警報等級,類型,觸發數值,聯鎖處置,狀態\n';
    const body = state.alarmState.history.map(h =>
      `"${h.time}",${h.severity},"${h.type}","${h.values}","${h.interlock}","${h.status}"`
    ).join('\n');
    downloadTextFile('\uFEFF' + header + body, 'Fooyin_Chlorine_Alarm_History_2026.csv', 'text/csv;charset=utf-8;');
  });

  // ============================================================
  // 9. 核心 UI 同步與 3D SCADA 渲染更新
  // ============================================================
  function syncUI() {
    state.freeChlorine = calculateFreeChlorine(state.cleanWaterOrp);

    // 計算各單元用電與評估餘氯警報
    evaluateUnitEnergy();
    evaluateChlorineAlarm();
    updateAutoAltCountdownUI();

    // 頂部 KPI
    document.getElementById('val-sed-ph').innerHTML = `${state.sedimentationPh.toFixed(2)} <span class="metric-unit">pH</span>`;
    document.getElementById('val-sed-orp').innerHTML = `${Math.round(state.sedimentationOrp)} <span class="metric-unit">mV</span>`;
    document.getElementById('val-clean-ph').innerHTML = `${state.cleanWaterPh.toFixed(2)} <span class="metric-unit">pH</span>`;
    document.getElementById('val-clean-orp').innerHTML = `${Math.round(state.cleanWaterOrp)} <span class="metric-unit">mV</span>`;
    document.getElementById('val-clean-chlorine').textContent = state.freeChlorine.toFixed(2);

    document.getElementById('hrs-pump-a').textContent = state.hoursPumpA.toFixed(1);
    document.getElementById('hrs-pump-b').textContent = state.hoursPumpB.toFixed(1);

    let pumpText = '雙泵待機';
    if (state.pumpAStatus === 'RUNNING' && state.pumpBStatus === 'RUNNING') pumpText = 'A + B 雙泵運轉';
    else if (state.pumpAStatus === 'RUNNING') pumpText = 'Pump A 運轉中';
    else if (state.pumpBStatus === 'RUNNING') pumpText = 'Pump B 運轉中';
    document.getElementById('val-pump-status').textContent = pumpText;

    const lvlBadge = document.getElementById('scada-water-level-badge');
    if (lvlBadge) {
      lvlBadge.textContent = `清水池水位：${state.cleanWaterLevel === 'LOW' ? 'LOW (低水位補水)' : state.cleanWaterLevel === 'HIGH' ? 'HIGH (滿水停泵)' : 'NORMAL (正常)'}`;
      lvlBadge.className = 'status-badge ' + (state.cleanWaterLevel === 'LOW' ? 'amber' : state.cleanWaterLevel === 'HIGH' ? 'green' : 'cyan');
    }

    // Relay switches sync
    const r1 = document.getElementById('ctrl-relay-1');
    const r2 = document.getElementById('ctrl-relay-2');
    const r3 = document.getElementById('ctrl-relay-3');
    const r4 = document.getElementById('ctrl-relay-4');
    if (r1) r1.checked = state.pumpAStatus === 'RUNNING';
    if (r2) r2.checked = state.pumpBStatus === 'RUNNING';
    if (r3) r3.checked = state.dosingPumpStatus === 'RUNNING';
    if (r4) r4.checked = state.airCleanPulse;

    // Metric Card Alarm Colors
    const cardOrp = document.getElementById('card-clean-orp');
    const cardPh = document.getElementById('card-clean-ph');
    const subPh = document.getElementById('sub-clean-ph');
    if (cardOrp) {
      cardOrp.className = state.alarmState.severity === 'CRITICAL' ? 'metric-card red' : state.alarmState.severity === 'WARNING' ? 'metric-card amber' : 'metric-card green';
    }
    if (cardPh) {
      const phOk = state.cleanWaterPh >= 6.0 && state.cleanWaterPh <= 8.5;
      cardPh.className = phOk ? 'metric-card green' : 'metric-card red';
      if (subPh) subPh.textContent = phOk ? '符合飲用水水質標準' : '⚠️ pH 超出法規 6.0~8.5 範圍';
    }

    // Sync 3D SCADA Digital Twin
    window.Water3DManager?.syncScada({
      sedimentationPh: state.sedimentationPh,
      sedimentationOrp: state.sedimentationOrp,
      cleanWaterPh: state.cleanWaterPh,
      cleanWaterOrp: state.cleanWaterOrp,
      freeChlorine: state.freeChlorine,
      cleanWaterLevel: state.cleanWaterLevel,
      pumpAStatus: state.pumpAStatus,
      pumpBStatus: state.pumpBStatus,
      dosingPumpStatus: state.dosingPumpStatus,
      airCleanPulse: state.airCleanPulse,
      ctrlMode: state.ctrlMode,
      totalKw: state.energySummary.totalKw,
      alarmSeverity: state.alarmState.severity,
      alarmCriticalLow: state.alarmConfig.critLowCl,
      alarmHigh: state.alarmConfig.highCl
    });
  }

  // ============================================================
  // 10. 自動 / 手動一體化控制邏輯 (Control Engine)
  // ============================================================
  function updateModeButtonsUI() {
    const btnAuto = document.getElementById('btn-mode-auto');
    const btnManual = document.getElementById('btn-mode-manual');
    const textMode = document.getElementById('text-ctrl-mode');
    if (btnAuto) btnAuto.className = 'mode-pill-btn' + (state.ctrlMode === 'AUTO' ? ' active-auto' : '');
    if (btnManual) btnManual.className = 'mode-pill-btn' + (state.ctrlMode === 'MANUAL' ? ' active-manual' : '');
    if (textMode) {
      textMode.textContent = state.ctrlMode === 'AUTO' ? 'AUTO (自動雙泵交替 & 聯鎖補氯)' : 'MANUAL (現場手動覆寫控制)';
      textMode.style.color = state.ctrlMode === 'AUTO' ? 'var(--accent-green)' : 'var(--accent-amber)';
    }
  }

  document.getElementById('btn-mode-auto')?.addEventListener('click', () => {
    state.ctrlMode = 'AUTO';
    updateModeButtonsUI();
    addEventLog('AUTO_LOGIC', '控制模式切換為 AUTO：啟用雙泵交替、水流加藥連動與餘氯不足聯鎖保護。');
    runControlLogic();
  });

  document.getElementById('btn-mode-manual')?.addEventListener('click', () => {
    state.ctrlMode = 'MANUAL';
    updateModeButtonsUI();
    addEventLog('INFO', '控制模式切換為 MANUAL：現場操作員可直接手動開關各組 Relay 輸出。');
    syncUI();
  });

  // Relay Manual/Direct Toggles (if toggled in AUTO, automatically notifies & switches to MANUAL so user sees immediate control!)
  function handleManualRelayOverride(name) {
    if (state.ctrlMode === 'AUTO') {
      state.ctrlMode = 'MANUAL';
      updateModeButtonsUI();
      addEventLog('WARN', `手動操作 [${name}]，系統自動切入 MANUAL 覆寫模式。`);
    }
  }

  function alternatePumpAB(reason) {
    const aRunning = state.pumpAStatus === 'RUNNING';
    const bRunning = state.pumpBStatus === 'RUNNING';
    if (aRunning && !bRunning) {
      state.pumpAStatus = 'STOPPED';
      state.pumpBStatus = 'RUNNING';
      state.lastActivePump = 'B';
    } else if (bRunning && !aRunning) {
      state.pumpAStatus = 'RUNNING';
      state.pumpBStatus = 'STOPPED';
      state.lastActivePump = 'A';
    } else {
      // Both stopped or both running -> alternate from lastActivePump
      if (state.lastActivePump === 'A') {
        state.pumpAStatus = 'STOPPED';
        state.pumpBStatus = 'RUNNING';
        state.lastActivePump = 'B';
      } else {
        state.pumpAStatus = 'RUNNING';
        state.pumpBStatus = 'STOPPED';
        state.lastActivePump = 'A';
      }
    }
    if (state.ctrlMode === 'AUTO') {
      state.dosingPumpStatus = 'RUNNING';
    }
    state.autoAlternateSec = 12;
    addEventLog('AUTO_LOGIC', `${reason}：已切換為砂濾泵 ${state.lastActivePump} (${state.lastActivePump === 'A' ? '左側' : '右側'}) 運轉。`);
    syncUI();
  }

  document.getElementById('ctrl-relay-1')?.addEventListener('change', (e) => {
    handleManualRelayOverride('Relay 1 砂濾泵 A');
    state.pumpAStatus = e.target.checked ? 'RUNNING' : 'STOPPED';
    if (state.pumpAStatus === 'RUNNING') state.lastActivePump = 'A';
    syncUI();
  });

  document.getElementById('ctrl-relay-2')?.addEventListener('change', (e) => {
    handleManualRelayOverride('Relay 2 砂濾泵 B');
    state.pumpBStatus = e.target.checked ? 'RUNNING' : 'STOPPED';
    if (state.pumpBStatus === 'RUNNING') state.lastActivePump = 'B';
    syncUI();
  });

  document.getElementById('btn-swap-pump-ab')?.addEventListener('click', () => {
    alternatePumpAB('操作員手動觸發雙泵交替');
  });

  document.getElementById('btn-run-both-pumps')?.addEventListener('click', () => {
    handleManualRelayOverride('雙泵 A+B 同時運轉');
    state.pumpAStatus = 'RUNNING';
    state.pumpBStatus = 'RUNNING';
    state.dosingPumpStatus = 'RUNNING';
    addEventLog('INFO', '啟動砂濾泵 A (左) + 砂濾泵 B (右) 雙泵並聯滿載運轉！');
    syncUI();
  });

  document.getElementById('cfg-auto-alternate')?.addEventListener('change', (e) => {
    state.autoAlternateEnabled = e.target.checked;
    state.autoAlternateSec = 12;
    updateAutoAltCountdownUI();
  });

  function updateAutoAltCountdownUI() {
    const el = document.getElementById('auto-alt-countdown');
    if (!el) return;
    if (state.ctrlMode !== 'AUTO') {
      el.textContent = 'MANUAL 手動中';
      el.style.color = '#fbbf24';
    } else if (!state.autoAlternateEnabled) {
      el.textContent = '定時輪換已停用';
      el.style.color = '#94a3b8';
    } else if (state.pumpAStatus !== 'RUNNING' && state.pumpBStatus !== 'RUNNING') {
      el.textContent = '待機中';
      el.style.color = '#94a3b8';
    } else {
      const nextPump = state.pumpAStatus === 'RUNNING' ? 'B' : 'A';
      el.textContent = `${state.autoAlternateSec}s 後換泵 ${nextPump}`;
      el.style.color = 'var(--primary-cyan)';
    }
  }

  document.getElementById('ctrl-relay-3')?.addEventListener('change', (e) => {
    handleManualRelayOverride('Relay 3 次氯酸鈉加藥泵');
    state.dosingPumpStatus = e.target.checked ? 'RUNNING' : 'STOPPED';
    syncUI();
  });

  document.getElementById('ctrl-relay-4')?.addEventListener('change', (e) => {
    state.airCleanPulse = e.target.checked;
    addEventLog('AIR_CLEAN', state.airCleanPulse ? '開啟 12VDC 電極空氣清洗泵' : '關閉電極空氣清洗泵');
    syncUI();
  });

  document.getElementById('btn-sim-low-level')?.addEventListener('click', () => {
    state.cleanWaterLevel = 'LOW';
    if (state.ctrlMode !== 'AUTO') {
      state.ctrlMode = 'AUTO';
      updateModeButtonsUI();
    }
    addEventLog('INFO', 'DI1 浮球開關觸發：清水池水位過低！');
    runControlLogic();
  });

  document.getElementById('btn-sim-high-level')?.addEventListener('click', () => {
    state.cleanWaterLevel = 'HIGH';
    if (state.ctrlMode !== 'AUTO') {
      state.ctrlMode = 'AUTO';
      updateModeButtonsUI();
    }
    addEventLog('INFO', 'DI1 浮球開關觸發：清水池滿水上限！');
    runControlLogic();
  });

  document.getElementById('btn-trigger-air-clean')?.addEventListener('click', () => {
    state.airCleanPulse = true;
    syncUI();
    addEventLog('AIR_CLEAN', '觸發 12VDC 空氣泵脈衝清洗 3D 電極膜 (演示 6 秒)');
    setTimeout(() => {
      state.airCleanPulse = false;
      syncUI();
      addEventLog('AIR_CLEAN', '電極噴氣清洗完成，自動回復待機節電。');
    }, 6000);
  });

  document.getElementById('slider-ph')?.addEventListener('input', (e) => {
    state.sedimentationPh = parseFloat(e.target.value);
    state.cleanWaterPh = parseFloat((state.sedimentationPh + 0.21).toFixed(2));
    document.getElementById('slider-val-ph').textContent = `${state.sedimentationPh.toFixed(2)} pH`;
    syncUI();
  });

  document.getElementById('slider-orp')?.addEventListener('input', (e) => {
    state.sedimentationOrp = parseInt(e.target.value, 10);
    const boost = state.dosingPumpStatus === 'RUNNING' ? (225 * state.dosingGainPct / 100) : 110;
    state.cleanWaterOrp = Math.max(460, Math.min(820, Math.round(state.sedimentationOrp + boost)));
    document.getElementById('slider-val-orp').textContent = `${state.sedimentationOrp} mV`;
    syncUI();
  });

  document.getElementById('slider-scada-dosing-gain')?.addEventListener('input', (e) => {
    state.dosingGainPct = parseInt(e.target.value, 10);
    document.getElementById('slider-val-dosing-gain').textContent = `${state.dosingGainPct}%`;
    syncUI();
  });

  function runControlLogic() {
    if (state.replay.active && !state.replay.paused) return; // Replay drives SCADA while playing

    if (state.ctrlMode === 'AUTO') {
      if (state.cleanWaterLevel === 'LOW') {
        state.cleanWaterLevel = 'NORMAL';
        alternatePumpAB('清水池低水位 DI1 自動觸發交替');
        return;
      } else if (state.cleanWaterLevel === 'HIGH') {
        state.pumpAStatus = 'STOPPED';
        state.pumpBStatus = 'STOPPED';
        addEventLog('AUTO_LOGIC', '清水池達高水位上限，DO4 自動停泵節能。');
      } else if (state.autoAlternateEnabled && (state.pumpAStatus === 'RUNNING' || state.pumpBStatus === 'RUNNING')) {
        state.autoAlternateSec -= 2;
        if (state.autoAlternateSec <= 0) {
          alternatePumpAB('AUTO 定時均時輪換');
          return;
        }
      }

      // Dosing pump interlock with flow OR low-chlorine protection
      if (state.pumpAStatus === 'RUNNING' || state.pumpBStatus === 'RUNNING') {
        state.dosingPumpStatus = 'RUNNING';
      } else if (!(state.alarmConfig.autoInterlock && state.freeChlorine < state.alarmConfig.warnLowCl)) {
        state.dosingPumpStatus = 'STOPPED';
      }
    }

    updateAutoAltCountdownUI();

    // Running hours accumulation
    if (state.pumpAStatus === 'RUNNING') state.hoursPumpA += 2 / 3600;
    if (state.pumpBStatus === 'RUNNING') state.hoursPumpB += 2 / 3600;

    // Water ORP / Chlorine physics response
    if (state.dosingPumpStatus === 'RUNNING') {
      const targetOrp = Math.min(820, state.sedimentationOrp + 225 * (state.dosingGainPct / 100));
      state.cleanWaterOrp += (targetOrp - state.cleanWaterOrp) * 0.08;
    } else {
      state.cleanWaterOrp = Math.max(490, state.cleanWaterOrp - 2.2);
    }

    syncUI();
  }
  setInterval(runControlLogic, 2000);

  // ============================================================
  // 11. 資料匯入、監控面回放、水質控管與多格式輸出 (Tab 4)
  // ============================================================
  let chartLongTermInstance = null;

  function parseCSVToRecords(csvText) {
    const cleanText = csvText.replace(/^\uFEFF/, '').trim();
    const lines = cleanText.split(/\r?\n/).filter(l => l.trim().length > 0);
    if (lines.length <= 1) return [];

    return lines.slice(1).map((line, idx) => {
      const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
      const sedPh = parseFloat(cols[1]) || 7.10;
      const sedOrp = parseFloat(cols[2]) || 480;
      const cleanPh = parseFloat(cols[3]) || 7.35;
      const cleanOrp = parseFloat(cols[4]) || 705;
      const level = cols[5] || 'NORMAL';
      const pumpA = cols[6] || 'RUNNING';
      const pumpB = cols[7] || 'STOPPED';
      const dose = cols[8] || 'RUNNING';
      const freeCl = !isNaN(parseFloat(cols[9])) ? parseFloat(cols[9]) : calculateFreeChlorine(cleanOrp);
      const air = cols[10] === '1' ? '1' : '0';
      const notes = cols[12] || cols[11] || '匯入紀錄';

      return {
        id: Date.now() + idx,
        timestamp: cols[0] || getDateTimeString(),
        sedPh,
        sedOrp,
        cleanPh,
        cleanOrp,
        level,
        pumpA,
        pumpB,
        dose,
        freeCl,
        air,
        notes
      };
    });
  }

  function evaluateRecordCompliance(rec) {
    const lowCl = rec.freeCl < state.alarmConfig.critLowCl;
    const warnCl = rec.freeCl < state.alarmConfig.warnLowCl;
    const highCl = rec.freeCl > state.alarmConfig.highCl;
    const badPh = rec.cleanPh < 6.0 || rec.cleanPh > 8.5;
    const lowOrp = rec.cleanOrp < state.alarmConfig.lowOrp;
    if (lowCl) return { pass: false, level: 'CRITICAL', label: '🚨 餘氯嚴重不足' };
    if (highCl) return { pass: false, level: 'CRITICAL', label: '☣️ 餘氯過高超標' };
    if (badPh) return { pass: false, level: 'CRITICAL', label: '⚠️ pH 超出法規' };
    if (warnCl || lowOrp) return { pass: false, level: 'WARNING', label: '⚠️ 餘氯/ORP 警戒' };
    return { pass: true, level: 'PASS', label: '✅ 法規合格' };
  }

  function renderImportedAndQCTables() {
    const records = state.importedData;
    const filterStatus = document.getElementById('filter-qc-status')?.value || 'ALL';
    const search = (document.getElementById('filter-search-text')?.value || '').toLowerCase();

    // Update QC KPIs & Header Compliance Rate
    let passCount = 0;
    let clAlarmCount = 0;
    let sumCl = 0;
    let sumOrp = 0;

    records.forEach(r => {
      const qc = evaluateRecordCompliance(r);
      if (qc.pass) passCount++;
      if (r.freeCl < state.alarmConfig.warnLowCl || r.freeCl > state.alarmConfig.highCl) clAlarmCount++;
      sumCl += r.freeCl;
      sumOrp += r.cleanOrp;
    });

    const total = records.length;
    const passRate = total ? Math.round((passCount / total) * 100) : 100;

    const elTot = document.getElementById('qc-total-rows');
    const elRate = document.getElementById('qc-pass-rate');
    const elLow = document.getElementById('qc-low-cl-count');
    const elAvgCl = document.getElementById('qc-avg-cl');
    const elAvgOrp = document.getElementById('qc-avg-orp');
    const elHdrRate = document.getElementById('compliance-rate');

    if (elTot) elTot.textContent = total;
    if (elRate) elRate.textContent = `${passRate}%`;
    if (elLow) elLow.textContent = clAlarmCount;
    if (elAvgCl) elAvgCl.textContent = total ? (sumCl / total).toFixed(2) : '0.00';
    if (elAvgOrp) elAvgOrp.textContent = total ? Math.round(sumOrp / total) : '0';
    if (elHdrRate) elHdrRate.textContent = `${passRate}%`;

    // Filtered rows for Data Management Table
    const filtered = records.filter(r => {
      const qc = evaluateRecordCompliance(r);
      if (filterStatus === 'ALARM' && qc.pass) return false;
      if (filterStatus === 'PASS' && !qc.pass) return false;
      if (search && !`${r.timestamp} ${r.notes} ${qc.label}`.toLowerCase().includes(search)) return false;
      return true;
    });

    const tbody = document.getElementById('table-imported-body');
    if (tbody) {
      tbody.innerHTML = filtered.map((r) => {
        const origIdx = records.indexOf(r);
        const qc = evaluateRecordCompliance(r);
        const isReplayingRow = state.replay.active && state.replay.index === origIdx;
        return `
          <tr class="${!qc.pass ? 'row-alarm' : ''} ${isReplayingRow ? 'row-active-replay' : ''}">
            <td style="font-family:var(--font-code);">${r.timestamp}</td>
            <td>${r.sedPh.toFixed(2)}</td>
            <td>${Math.round(r.sedOrp)}</td>
            <td>${r.cleanPh.toFixed(2)}</td>
            <td>${Math.round(r.cleanOrp)}</td>
            <td style="font-family:var(--font-code); font-weight:700; color:${r.freeCl < state.alarmConfig.critLowCl ? '#f87171' : '#00f2fe'};">${r.freeCl.toFixed(2)}</td>
            <td>${r.pumpA === 'RUNNING' ? 'A運轉' : r.pumpB === 'RUNNING' ? 'B運轉' : '待機'}</td>
            <td><span class="badge-status ${qc.pass ? 'green' : qc.level === 'CRITICAL' ? 'red' : 'amber'}">${qc.label}</span></td>
            <td>${r.notes}</td>
            <td>
              <button class="industrial-btn cyan sm" data-push-idx="${origIdx}" title="推送此筆至 3D SCADA 監控面"><i class="fa-solid fa-cube"></i></button>
              <button class="industrial-btn red sm" data-del-idx="${origIdx}" title="刪除紀錄"><i class="fa-solid fa-trash"></i></button>
            </td>
          </tr>
        `;
      }).join('');

      tbody.querySelectorAll('[data-push-idx]').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.dataset.pushIdx, 10);
          applyRecordToScada(records[idx], idx);
          switchToTab('tab-scada');
        });
      });

      tbody.querySelectorAll('[data-del-idx]').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.dataset.delIdx, 10);
          state.importedData.splice(idx, 1);
          renderImportedAndQCTables();
          renderLongTermChart();
        });
      });
    }

    // Update Statutory Printable Table
    const tbodyStat = document.getElementById('table-statutory-body');
    if (tbodyStat) {
      tbodyStat.innerHTML = records.slice(0, 15).map(r => {
        const qc = evaluateRecordCompliance(r);
        return `
          <tr>
            <td>${r.timestamp}</td>
            <td>${r.sedPh.toFixed(2)}</td>
            <td>${Math.round(r.sedOrp)}</td>
            <td>${r.cleanPh.toFixed(2)}</td>
            <td>${Math.round(r.cleanOrp)}</td>
            <td><strong>${r.freeCl.toFixed(2)}</strong></td>
            <td>${r.air === '1' ? '已執行噴氣' : '常態監測'}</td>
            <td><strong style="color:${qc.pass ? 'green' : '#dc2626'};">${qc.pass ? '合格' : '異常處理'}</strong></td>
            <td>環工系 / 營繕組</td>
          </tr>
        `;
      }).join('');
    }

    updateReplayProgressText();
  }

  function renderLongTermChart() {
    const ctx = document.getElementById('chartLongTerm');
    if (!ctx) return;
    if (chartLongTermInstance) chartLongTermInstance.destroy();

    const recs = state.importedData;
    const labels = recs.map(r => r.timestamp.split(' ')[1] || r.timestamp);
    const cleanOrp = recs.map(r => r.cleanOrp);
    const freeCl = recs.map(r => r.freeCl);
    const minClLine = recs.map(() => state.alarmConfig.critLowCl);

    chartLongTermInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: '清水池自由餘氯 (mg/L)',
            data: freeCl,
            borderColor: '#00f2fe',
            backgroundColor: 'rgba(0, 242, 254, 0.14)',
            borderWidth: 3,
            fill: true,
            tension: 0.3,
            yAxisID: 'yCl'
          },
          {
            label: '餘氯不足法規下限 (ALARM)',
            data: minClLine,
            borderColor: '#ef4444',
            borderWidth: 2,
            borderDash: [6, 4],
            pointRadius: 0,
            fill: false,
            yAxisID: 'yCl'
          },
          {
            label: '清水池 ORP (mV)',
            data: cleanOrp,
            borderColor: '#f59e0b',
            backgroundColor: 'transparent',
            borderWidth: 2,
            tension: 0.3,
            yAxisID: 'yOrp'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#e2e8f0', font: { size: 11 } } } },
        scales: {
          x: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.05)' } },
          yCl: {
            position: 'left',
            title: { display: true, text: '自由餘氯 (mg/L)', color: '#00f2fe' },
            min: 0,
            max: 1.4,
            ticks: { color: '#00f2fe' },
            grid: { color: 'rgba(255,255,255,0.07)' }
          },
          yOrp: {
            position: 'right',
            title: { display: true, text: 'ORP (mV)', color: '#f59e0b' },
            min: 450,
            max: 800,
            ticks: { color: '#f59e0b' },
            grid: { drawOnChartArea: false }
          }
        }
      }
    });
  }

  function loadCSVText(csvText, sourceName) {
    const parsed = parseCSVToRecords(csvText);
    if (!parsed.length) {
      alert('無法解析 CSV 檔案，請確認欄位格式！');
      return;
    }
    stopReplay();
    state.importedData = parsed;
    renderImportedAndQCTables();
    renderLongTermChart();
    addEventLog('INFO', `已成功匯入 [${sourceName}] 共 ${parsed.length} 筆水質數據，可點擊「回放至 3D 監控」呈現！`);
  }

  // File input & Drag-and-Drop
  const fileInput = document.getElementById('file-input');
  const dropZone = document.getElementById('drop-zone');

  function readUploadedFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => loadCSVText(ev.target.result, file.name);
    reader.readAsText(file, 'UTF-8');
  }

  fileInput?.addEventListener('change', (e) => {
    readUploadedFile(e.target.files[0]);
    e.target.value = '';
  });

  if (dropZone) {
    ['dragenter', 'dragover'].forEach(evt => {
      dropZone.addEventListener(evt, (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
      });
    });
    ['dragleave', 'drop'].forEach(evt => {
      dropZone.addEventListener(evt, (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
      });
    });
    dropZone.addEventListener('drop', (e) => {
      const f = e.dataTransfer?.files?.[0];
      if (f) readUploadedFile(f);
    });
  }

  document.getElementById('btn-load-sample')?.addEventListener('click', () => {
    fetch('sample_data.csv')
      .then(res => (res.ok ? res.text() : EMBEDDED_SAMPLE_CSV))
      .then(txt => loadCSVText(txt, 'sample_data.csv'))
      .catch(() => loadCSVText(EMBEDDED_SAMPLE_CSV, 'sample_data.csv (內建)'));
  });

  document.getElementById('btn-load-alarm-sample')?.addEventListener('click', () => {
    loadCSVText(EMBEDDED_ALARM_TEST_CSV, '餘氯不足異常情境測試檔');
  });

  // Historical Data Replay to 3D SCADA Monitoring
  function applyRecordToScada(rec, idx) {
    if (!rec) return;
    state.sedimentationPh = rec.sedPh;
    state.sedimentationOrp = rec.sedOrp;
    state.cleanWaterPh = rec.cleanPh;
    state.cleanWaterOrp = rec.cleanOrp;
    state.cleanWaterLevel = rec.level;
    state.pumpAStatus = rec.pumpA;
    state.pumpBStatus = rec.pumpB;
    state.dosingPumpStatus = rec.dose;
    state.airCleanPulse = rec.air === '1';

    const pill = document.getElementById('replay-live-pill');
    const pillTime = document.getElementById('replay-live-time');
    if (pill) pill.classList.add('active');
    if (pillTime) pillTime.textContent = `${rec.timestamp} (#${idx + 1})`;

    addEventLog('REPLAY', `監控回放 [${rec.timestamp}] 餘氯 ${rec.freeCl.toFixed(2)} mg/L | ORP ${rec.cleanOrp} mV — ${rec.notes}`);
    syncUI();
    renderImportedAndQCTables();
  }

  function updateReplayProgressText() {
    const el = document.getElementById('replay-progress-text');
    if (!el) return;
    const total = state.importedData.length;
    if (!state.replay.active) el.textContent = `待命中 (0 / ${total})`;
    else el.textContent = `${state.replay.paused ? '已暫停' : '回放中'} (${state.replay.index + 1} / ${total})`;
  }

  function startReplay() {
    if (!state.importedData.length) return;
    if (state.replay.timer) clearInterval(state.replay.timer);
    state.replay.active = true;
    state.replay.paused = false;
    const speedMs = parseInt(document.getElementById('replay-speed')?.value || '1000', 10);

    applyRecordToScada(state.importedData[state.replay.index], state.replay.index);

    state.replay.timer = setInterval(() => {
      if (state.replay.paused) return;
      state.replay.index = (state.replay.index + 1) % state.importedData.length;
      applyRecordToScada(state.importedData[state.replay.index], state.replay.index);
    }, speedMs);
    updateReplayProgressText();
  }

  function stopReplay() {
    if (state.replay.timer) clearInterval(state.replay.timer);
    state.replay.timer = null;
    state.replay.active = false;
    state.replay.paused = false;
    state.replay.index = 0;
    document.getElementById('replay-live-pill')?.classList.remove('active');
    updateReplayProgressText();
    renderImportedAndQCTables();
  }

  document.getElementById('btn-replay-play')?.addEventListener('click', startReplay);
  document.getElementById('btn-replay-pause')?.addEventListener('click', () => {
    if (!state.replay.active) return;
    state.replay.paused = !state.replay.paused;
    updateReplayProgressText();
  });
  document.getElementById('btn-replay-stop')?.addEventListener('click', stopReplay);
  document.getElementById('btn-jump-scada-watch')?.addEventListener('click', () => {
    if (!state.replay.active) startReplay();
    switchToTab('tab-scada');
  });

  // Search, Filter & Manual Add Record
  document.getElementById('filter-qc-status')?.addEventListener('change', renderImportedAndQCTables);
  document.getElementById('filter-search-text')?.addEventListener('input', renderImportedAndQCTables);

  document.getElementById('btn-add-manual-record')?.addEventListener('click', () => {
    const sedPh = parseFloat(document.getElementById('add-rec-sed-ph')?.value) || state.sedimentationPh;
    const sedOrp = parseFloat(document.getElementById('add-rec-sed-orp')?.value) || state.sedimentationOrp;
    const cleanPh = parseFloat(document.getElementById('add-rec-clean-ph')?.value) || state.cleanWaterPh;
    const cleanOrp = parseFloat(document.getElementById('add-rec-clean-orp')?.value) || state.cleanWaterOrp;
    const note = document.getElementById('add-rec-note')?.value.trim() || '人工巡檢手動登錄';
    const freeCl = calculateFreeChlorine(cleanOrp);

    state.importedData.unshift({
      id: Date.now(),
      timestamp: getDateTimeString(),
      sedPh,
      sedOrp,
      cleanPh,
      cleanOrp,
      level: state.cleanWaterLevel,
      pumpA: state.pumpAStatus,
      pumpB: state.pumpBStatus,
      dose: state.dosingPumpStatus,
      freeCl,
      air: state.airCleanPulse ? '1' : '0',
      notes: note
    });
    renderImportedAndQCTables();
    renderLongTermChart();
    document.getElementById('add-rec-note').value = '';
    addEventLog('INFO', `已手動補登水質檢驗紀錄 (餘氯 ${freeCl.toFixed(2)} mg/L)。`);
  });

  // Export CSV (UTF-8 BOM) / JSON / Print
  function downloadTextFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  document.getElementById('btn-export-csv')?.addEventListener('click', () => {
    const header = 'Timestamp,Sedimentation_pH,Sedimentation_ORP,CleanWater_pH,CleanWater_ORP,CleanWater_Level,Pump_A_Status,Pump_B_Status,Dosing_Pump_Status,Free_Chlorine_mgL,Air_Clean_Pulse,QC_Status,Notes\n';
    const body = state.importedData.map(r => {
      const qc = evaluateRecordCompliance(r);
      return `${r.timestamp},${r.sedPh},${r.sedOrp},${r.cleanPh},${r.cleanOrp},${r.level},${r.pumpA},${r.pumpB},${r.dose},${r.freeCl},${r.air},${qc.pass ? 'PASS' : qc.level},"${r.notes}"`;
    }).join('\n');
    downloadTextFile('\uFEFF' + header + body, 'Fooyin_Water_Quality_QC_Report_2026.csv', 'text/csv;charset=utf-8;');
  });

  document.getElementById('btn-export-json')?.addEventListener('click', () => {
    const payload = {
      exportedAt: getDateTimeString(),
      alarmConfig: state.alarmConfig,
      alarmHistory: state.alarmState.history,
      energySummary: state.energySummary,
      waterQualityRecords: state.importedData
    };
    downloadTextFile(JSON.stringify(payload, null, 2), 'Fooyin_SCADA_System_Backup_2026.json', 'application/json');
  });

  document.getElementById('btn-print-statutory')?.addEventListener('click', () => window.print());

  // ============================================================
  // 12. 3D 加氯 / 減氯與 pH 物種解離模擬器引擎 (Tab 2)
  // ============================================================
  const gameState = {
    mode: 'SANDBOX',
    score: 100,
    timeLeft: 0,
    timerInterval: null,
    naoclRate: 35,
    nahso3Rate: 0,
    inflow: 50,
    organicLoad: 0,
    chlorine: 0.58,
    orp: 710,
    thm: 8,
    pathogenProtection: 99.99,
    questTimeInZone: 0,
    history: { labels: [], chlorine: [], naocl: [], nahso3: [] }
  };

  const speciationState = {
    source: 'NaOCl',
    basePh: 7.2,
    ph: 7.2,
    hclDose: 0.0,
    naohDose: 0.0,
    totalChlorine: 0.60,
    pKa: 7.53,
    hoclPct: 68.1,
    oclPct: 31.9,
    hoclVal: 0.41,
    oclVal: 0.19,
    disinfectionPower: 68.5
  };

  let chartChlorineInstance = null;
  let chartPhSpeciationInstance = null;

  function renderChlorineGameChart() {
    const ctx = document.getElementById('chartChlorineGame');
    if (!ctx || chartChlorineInstance) return;

    chartChlorineInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: gameState.history.labels,
        datasets: [
          {
            label: '自由有效餘氯 (mg/L)',
            data: gameState.history.chlorine,
            borderColor: '#00f2fe',
            borderWidth: 3,
            backgroundColor: 'rgba(0, 242, 254, 0.12)',
            fill: true,
            tension: 0.3,
            yAxisID: 'y'
          },
          {
            label: 'NaOCl 加氯 (mL/min)',
            data: gameState.history.naocl,
            borderColor: '#38bdf8',
            borderWidth: 2,
            borderDash: [4, 4],
            backgroundColor: 'transparent',
            yAxisID: 'y1'
          },
          {
            label: 'NaHSO₃ 脫氯 (mL/min)',
            data: gameState.history.nahso3,
            borderColor: '#34d399',
            borderWidth: 2,
            borderDash: [2, 2],
            backgroundColor: 'transparent',
            yAxisID: 'y1'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#cbd5e1', font: { size: 10 } } } },
        scales: {
          x: { ticks: { color: '#94a3b8', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
          y: { title: { display: true, text: '餘氯 mg/L', color: '#00f2fe' }, min: 0, max: 2.2, ticks: { color: '#00f2fe' }, grid: { color: 'rgba(255,255,255,0.08)' } },
          y1: { position: 'right', title: { display: true, text: 'mL/min', color: '#94a3b8' }, min: 0, max: 100, ticks: { color: '#94a3b8' }, grid: { drawOnChartArea: false } }
        }
      }
    });
  }

  function updateChlorineGamePhysics() {
    const naoclInput = (gameState.naoclRate / 35) * 0.012 * (50 / gameState.inflow);
    const nahso3Neutralization = (gameState.nahso3Rate / 30) * 0.018;
    const organicConsumption = gameState.organicLoad * 0.022;
    const baseDecay = 0.003;

    const delta = naoclInput - nahso3Neutralization - organicConsumption - baseDecay;
    gameState.chlorine = Math.max(0.01, Math.min(2.4, gameState.chlorine + delta));

    if (gameState.chlorine <= 0.02) gameState.orp = 450;
    else gameState.orp = Math.max(420, Math.min(850, Math.round(145.2 * Math.log(gameState.chlorine) + 788.4)));

    if (gameState.chlorine > 1.0) gameState.thm = Math.round(8 + Math.pow((gameState.chlorine - 1.0) * 12, 1.8));
    else gameState.thm = Math.max(3, Math.round(gameState.chlorine * 12));

    gameState.pathogenProtection = gameState.chlorine < 0.2
      ? parseFloat(((gameState.chlorine / 0.2) * 99.9).toFixed(1))
      : 99.99;

    syncGameMetricsUI();
    window.Water3DManager?.syncChlorine(gameState, speciationState);

    const now = new Date();
    const ts = `${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
    gameState.history.labels.push(ts);
    gameState.history.chlorine.push(parseFloat(gameState.chlorine.toFixed(2)));
    gameState.history.naocl.push(gameState.naoclRate);
    gameState.history.nahso3.push(gameState.nahso3Rate);
    if (gameState.history.labels.length > 25) {
      gameState.history.labels.shift();
      gameState.history.chlorine.shift();
      gameState.history.naocl.shift();
      gameState.history.nahso3.shift();
    }
    if (chartChlorineInstance) chartChlorineInstance.update('none');

    if (gameState.mode !== 'SANDBOX') evaluateQuestProgress();
  }
  setInterval(updateChlorineGamePhysics, 1000);

  function syncGameMetricsUI() {
    document.getElementById('cg-metric-chlorine').innerHTML = `${gameState.chlorine.toFixed(2)} <span class="metric-unit">mg/L</span>`;
    document.getElementById('cg-metric-orp').innerHTML = `${gameState.orp} <span class="metric-unit">mV</span>`;
    document.getElementById('cg-metric-thm').innerHTML = `${gameState.thm} <span class="metric-unit">ppb</span>`;
    document.getElementById('cg-metric-pathogen').innerHTML = `${gameState.pathogenProtection} <span class="metric-unit">%</span>`;

    const cardCl = document.getElementById('card-cg-chlorine');
    const subCl = document.getElementById('cg-sub-chlorine');
    const badge = document.getElementById('cg-status-badge');

    if (gameState.chlorine >= 0.2 && gameState.chlorine <= 1.0) {
      cardCl.className = 'metric-card green';
      subCl.textContent = '法規合格 (0.2 ~ 1.0 mg/L)';
      badge.className = 'badge-status green';
      badge.textContent = '水質法規合規 (PASS)';
    } else if (gameState.chlorine < 0.2) {
      cardCl.className = 'metric-card red';
      subCl.textContent = '🚨 餘氯不足 (消毒防護失效)';
      badge.className = 'badge-status red';
      badge.textContent = '🚨 餘氯不足警報';
    } else {
      cardCl.className = 'metric-card red';
      subCl.textContent = '⚠️ 餘氯過高 (三鹵甲烷風險)';
      badge.className = 'badge-status red';
      badge.textContent = '⚠️ 過度加氯警報';
    }

    document.getElementById('card-cg-thm').className = gameState.thm > 80 ? 'metric-card red' : 'metric-card purple';
    document.getElementById('cg-score-display').textContent = gameState.score;
    document.getElementById('cg-timer-display').textContent = gameState.mode === 'SANDBOX' ? '-- s' : `${gameState.timeLeft} s`;

    const modeMap = { SANDBOX: '自由動態沙盒', QUEST_1: '關卡 1：暴雨處置', QUEST_2: '關卡 2：減氯中和救援', QUEST_3: '關卡 3：60秒動態恆定' };
    document.getElementById('cg-mode-text').textContent = modeMap[gameState.mode] || '自由動態沙盒';
  }

  document.getElementById('cg-slider-naocl')?.addEventListener('input', (e) => {
    gameState.naoclRate = parseInt(e.target.value, 10);
    document.getElementById('cg-val-naocl-rate').textContent = `${gameState.naoclRate} mL/min`;
  });

  document.getElementById('cg-slider-nahso3')?.addEventListener('input', (e) => {
    gameState.nahso3Rate = parseInt(e.target.value, 10);
    document.getElementById('cg-val-nahso3-rate').textContent = `${gameState.nahso3Rate} mL/min`;
  });

  document.getElementById('cg-slider-inflow')?.addEventListener('input', (e) => {
    gameState.inflow = parseInt(e.target.value, 10);
    document.getElementById('cg-val-inflow').textContent = `${gameState.inflow} L/min`;
  });

  document.getElementById('btn-cg-toggle-organic')?.addEventListener('click', () => {
    gameState.organicLoad = gameState.organicLoad > 0 ? 0 : 1.0;
    addEventLog(gameState.organicLoad > 0 ? 'ALARM' : 'INFO', gameState.organicLoad > 0 ? '🌧️ 3D 反應槽觸發暴雨有機物飆升！' : '已解除反應槽暴雨有機物干擾。');
  });

  function startQuest(mode) {
    if (gameState.timerInterval) clearInterval(gameState.timerInterval);
    gameState.mode = mode;
    gameState.questTimeInZone = 0;

    const setRates = (naocl, nahso3) => {
      gameState.naoclRate = naocl;
      gameState.nahso3Rate = nahso3;
      document.getElementById('cg-slider-naocl').value = naocl;
      document.getElementById('cg-slider-nahso3').value = nahso3;
      document.getElementById('cg-val-naocl-rate').textContent = `${naocl} mL/min`;
      document.getElementById('cg-val-nahso3-rate').textContent = `${nahso3} mL/min`;
    };

    if (mode === 'SANDBOX') {
      gameState.score = 100;
      gameState.timeLeft = 0;
      gameState.organicLoad = 0;
      gameState.chlorine = 0.58;
      setRates(35, 0);
      return;
    }

    if (mode === 'QUEST_1') {
      gameState.timeLeft = 30;
      gameState.score = 100;
      gameState.organicLoad = 1.2;
      gameState.chlorine = 0.08;
      setRates(10, 0);
      addEventLog('ALARM', '🎮 啟動 3D 關卡 1【暴雨處置】：餘氯跌至 0.08 mg/L，請於 30 秒內加大 NaOCl 補氯！');
    } else if (mode === 'QUEST_2') {
      gameState.timeLeft = 25;
      gameState.score = 100;
      gameState.organicLoad = 0;
      gameState.chlorine = 1.85;
      setRates(90, 0);
      addEventLog('ALARM', '🎮 啟動 3D 關卡 2【過度加氯救援】：餘氯達 1.85 mg/L，請調低 NaOCl 並啟動 NaHSO₃ 中和！');
    } else if (mode === 'QUEST_3') {
      gameState.timeLeft = 60;
      gameState.score = 100;
      gameState.organicLoad = 0;
      gameState.chlorine = 0.55;
      setRates(35, 0);
      addEventLog('INFO', '🎮 啟動 3D 關卡 3【60秒動態流量恆定考驗】！');
    }

    gameState.timerInterval = setInterval(() => {
      if (gameState.timeLeft > 0) {
        gameState.timeLeft--;
        if (gameState.mode === 'QUEST_3' && gameState.timeLeft % 8 === 0) {
          gameState.inflow = Math.floor(30 + Math.random() * 50);
          document.getElementById('cg-slider-inflow').value = gameState.inflow;
          document.getElementById('cg-val-inflow').textContent = `${gameState.inflow} L/min`;
        }
      } else {
        clearInterval(gameState.timerInterval);
        finishQuest();
      }
    }, 1000);
  }

  function evaluateQuestProgress() {
    if (gameState.mode === 'QUEST_1') {
      if (gameState.chlorine >= 0.4 && gameState.chlorine <= 0.8) gameState.questTimeInZone++;
      else gameState.score = Math.max(50, gameState.score - 1);
    } else if (gameState.mode === 'QUEST_2') {
      if (gameState.chlorine >= 0.3 && gameState.chlorine <= 0.8) gameState.questTimeInZone++;
      else gameState.score = Math.max(40, gameState.score - 2);
    } else if (gameState.mode === 'QUEST_3') {
      if (gameState.chlorine >= 0.5 && gameState.chlorine <= 0.7) gameState.questTimeInZone++;
      else gameState.score = Math.max(30, gameState.score - 1);
    }
  }

  function finishQuest() {
    let success = false;
    let msg = '';
    if (gameState.mode === 'QUEST_1') {
      success = gameState.chlorine >= 0.3 && gameState.chlorine <= 0.9 && gameState.questTimeInZone >= 10;
      msg = success ? '🎉 恭喜通過【暴雨緊急處置關】！' : '❌ 關卡失敗！餘氯未及時恢復至安全範圍。';
    } else if (gameState.mode === 'QUEST_2') {
      success = gameState.chlorine >= 0.2 && gameState.chlorine <= 0.9 && gameState.questTimeInZone >= 8;
      msg = success ? '🎉 恭喜通過【加藥過量減氯中和關】！' : '❌ 關卡失敗！過量餘氯未能及時中和。';
    } else if (gameState.mode === 'QUEST_3') {
      success = gameState.questTimeInZone >= 35 && gameState.score >= 70;
      msg = success ? '🏆 恭喜通過【60秒動態流量恆定考驗】！' : '❌ 關卡失敗！餘氯波動超出區間。';
    }
    alert(msg);
    startQuest('SANDBOX');
  }

  document.getElementById('btn-cg-sandbox')?.addEventListener('click', () => startQuest('SANDBOX'));
  document.getElementById('btn-cg-quest-1')?.addEventListener('click', () => startQuest('QUEST_1'));
  document.getElementById('btn-cg-quest-2')?.addEventListener('click', () => startQuest('QUEST_2'));
  document.getElementById('btn-cg-quest-3')?.addEventListener('click', () => startQuest('QUEST_3'));
  document.getElementById('btn-back-to-pbl-1')?.addEventListener('click', () => switchToTab('tab-education'));

  // pH Speciation Engine
  function updatePhFromDosing() {
    const netDose = speciationState.naohDose - speciationState.hclDose;
    const finalPh = Math.max(4.0, Math.min(10.0, parseFloat((speciationState.basePh + netDose * 0.08).toFixed(2))));
    const sliderPh = document.getElementById('slider-speciation-ph');
    if (sliderPh) sliderPh.value = finalPh.toFixed(1);
    calcPhSpeciation(finalPh, speciationState.totalChlorine);
  }

  function calcPhSpeciation(ph, totalCl) {
    const ratio = Math.pow(10, ph - speciationState.pKa);
    const hoclFrac = 1 / (1 + ratio);
    const oclFrac = ratio / (1 + ratio);

    speciationState.ph = ph;
    speciationState.totalChlorine = totalCl;
    speciationState.hoclPct = parseFloat((hoclFrac * 100).toFixed(1));
    speciationState.oclPct = parseFloat((oclFrac * 100).toFixed(1));
    speciationState.hoclVal = parseFloat((totalCl * hoclFrac).toFixed(2));
    speciationState.oclVal = parseFloat((totalCl * oclFrac).toFixed(2));
    speciationState.disinfectionPower = parseFloat((speciationState.hoclPct + speciationState.oclPct * 0.0125).toFixed(1));

    document.getElementById('speciation-ph-val').textContent = `${ph.toFixed(2)} pH`;
    document.getElementById('speciation-dose-val').textContent = `${totalCl.toFixed(2)} mg/L`;
    document.getElementById('spec-val-hcl-dose').textContent = `${speciationState.hclDose.toFixed(1)} mL/min`;
    document.getElementById('spec-val-naoh-dose').textContent = `${speciationState.naohDose.toFixed(1)} mL/min`;
    document.getElementById('slider-spec-hcl').value = speciationState.hclDose;
    document.getElementById('slider-spec-naoh').value = speciationState.naohDose;
    document.getElementById('spec-val-hocl').innerHTML = `${speciationState.hoclVal.toFixed(2)} <span class="metric-unit">mg/L</span>`;
    document.getElementById('spec-pct-hocl').textContent = `佔比 ${speciationState.hoclPct}%`;
    document.getElementById('spec-val-ocl').innerHTML = `${speciationState.oclVal.toFixed(2)} <span class="metric-unit">mg/L</span>`;
    document.getElementById('spec-pct-ocl').textContent = `佔比 ${speciationState.oclPct}%`;
    document.getElementById('spec-val-power').innerHTML = `${speciationState.disinfectionPower} <span class="metric-unit">%</span>`;

    const subPower = document.getElementById('spec-sub-power');
    const zoneTag = document.getElementById('speciation-zone-tag');
    if (ph >= 6.5 && ph <= 7.5) {
      subPower.textContent = '🌟 黃金最佳消毒區';
      zoneTag.className = 'status-badge green';
      zoneTag.textContent = '黃金消毒區 (pH 6.5 ~ 7.5)';
    } else if (ph < 6.5) {
      subPower.textContent = '⚡ 微酸強效區 (留意腐蝕)';
      zoneTag.className = 'status-badge cyan';
      zoneTag.textContent = '微酸強效區 (pH < 6.5)';
    } else {
      subPower.textContent = '⚠️ 鹼性低效區 (OCl⁻ 主導)';
      zoneTag.className = 'status-badge red';
      zoneTag.textContent = '鹼性低效區 (pH > 7.5)';
    }

    const eqEl = document.getElementById('chem-source-eq');
    const descEl = document.getElementById('chem-source-desc');
    if (speciationState.source === 'NaOCl') {
      eqEl.textContent = 'NaOCl + H₂O ⇌ HOCl + Na⁺ + OH⁻';
      descEl.textContent = 'NaOCl 溶於水釋放 OH⁻ 使水體 pH 提升；解離產生的 HOCl 殺菌力為 OCl⁻ 的 80 倍。';
    } else {
      eqEl.textContent = 'Cl₂(g) + H₂O ⇌ HOCl + H⁺ + Cl⁻';
      descEl.textContent = 'Cl₂ 溶於水釋放 H⁺ 使水體 pH 下降；需留意過酸逸散風險，必要時加鹼調節。';
    }

    renderPhSpeciationChart();
    window.Water3DManager?.syncChlorine(gameState, speciationState);
  }

  function renderPhSpeciationChart() {
    const ctx = document.getElementById('chartPhSpeciation');
    if (!ctx) return;

    const phLabels = [];
    const hoclData = [];
    const oclData = [];
    const dotData = [];
    const totalCl = speciationState.totalChlorine;

    for (let p = 4.0; p <= 10.01; p += 0.2) {
      const pv = parseFloat(p.toFixed(1));
      phLabels.push(pv);
      const r = Math.pow(10, pv - speciationState.pKa);
      const hv = parseFloat((totalCl / (1 + r)).toFixed(2));
      const ov = parseFloat((totalCl * (r / (1 + r))).toFixed(2));
      hoclData.push(hv);
      oclData.push(ov);
      dotData.push(Math.abs(pv - parseFloat(speciationState.ph.toFixed(1))) < 0.15 ? hv : null);
    }

    const maxScale = Math.max(1.0, parseFloat((totalCl * 1.15).toFixed(2)));
    if (chartPhSpeciationInstance) {
      chartPhSpeciationInstance.data.labels = phLabels;
      chartPhSpeciationInstance.data.datasets[0].data = hoclData;
      chartPhSpeciationInstance.data.datasets[1].data = oclData;
      chartPhSpeciationInstance.data.datasets[2].data = dotData;
      chartPhSpeciationInstance.options.scales.y.max = maxScale;
      chartPhSpeciationInstance.update('none');
      return;
    }

    chartPhSpeciationInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: phLabels,
        datasets: [
          { label: 'HOCl (mg/L)', data: hoclData, borderColor: '#00f2fe', backgroundColor: 'rgba(0,242,254,0.15)', fill: true, tension: 0.4 },
          { label: 'OCl⁻ (mg/L)', data: oclData, borderColor: '#10b981', borderDash: [3, 3], backgroundColor: 'transparent', tension: 0.4 },
          { label: '當前 pH', data: dotData, borderColor: '#ef4444', backgroundColor: '#ef4444', pointRadius: 6, showLine: false }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#cbd5e1', font: { size: 10 } } } },
        scales: {
          x: { ticks: { color: '#94a3b8', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
          y: { min: 0, max: maxScale, ticks: { color: '#94a3b8', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.05)' } }
        }
      }
    });
  }

  document.getElementById('slider-speciation-ph')?.addEventListener('input', (e) => {
    speciationState.basePh = parseFloat(e.target.value);
    speciationState.hclDose = 0;
    speciationState.naohDose = 0;
    updatePhFromDosing();
  });

  document.getElementById('slider-speciation-dose')?.addEventListener('input', (e) => {
    calcPhSpeciation(speciationState.ph, parseFloat(e.target.value));
  });

  document.getElementById('slider-spec-hcl')?.addEventListener('input', (e) => {
    speciationState.hclDose = parseFloat(e.target.value);
    updatePhFromDosing();
  });

  document.getElementById('slider-spec-naoh')?.addEventListener('input', (e) => {
    speciationState.naohDose = parseFloat(e.target.value);
    updatePhFromDosing();
  });

  document.getElementById('btn-titrate-hcl')?.addEventListener('click', () => {
    speciationState.hclDose = Math.min(50, speciationState.hclDose + 5);
    updatePhFromDosing();
  });

  document.getElementById('btn-titrate-naoh')?.addEventListener('click', () => {
    speciationState.naohDose = Math.min(50, speciationState.naohDose + 5);
    updatePhFromDosing();
  });

  document.getElementById('btn-titrate-reset')?.addEventListener('click', () => {
    speciationState.hclDose = 0;
    speciationState.naohDose = 0;
    speciationState.basePh = 7.2;
    updatePhFromDosing();
  });

  document.getElementById('btn-source-naocl')?.addEventListener('click', () => {
    speciationState.source = 'NaOCl';
    speciationState.naohDose = Math.min(50, speciationState.naohDose + 3.5);
    updatePhFromDosing();
  });

  document.getElementById('btn-source-cl2')?.addEventListener('click', () => {
    speciationState.source = 'Cl2';
    speciationState.hclDose = Math.min(50, speciationState.hclDose + 4.5);
    updatePhFromDosing();
  });

  document.getElementById('btn-ph-challenge')?.addEventListener('click', () => {
    speciationState.source = 'NaOCl';
    speciationState.hclDose = 0;
    speciationState.naohDose = 20;
    speciationState.basePh = 7.2;
    updatePhFromDosing();
    alert('🏆 啟動【pH 黃金區間配比挑戰】：水體鹼化至 pH 8.8 (HOCl 僅約 5%)，請加酸 (HCl) 將 pH 調回 6.5~7.2，使 HOCl 達 75% 以上！');
    const chk = setInterval(() => {
      if (speciationState.hoclPct >= 75 && speciationState.ph >= 6.5 && speciationState.ph <= 7.2) {
        clearInterval(chk);
        alert(`🎉 通關成功！pH = ${speciationState.ph.toFixed(2)}，3D 反應槽內強效 HOCl 分子比例達 ${speciationState.hoclPct}%！`);
      }
    }, 1000);
    setTimeout(() => clearInterval(chk), 45000);
  });

  // ============================================================
  // 13. 雙師教學：Modbus RTU 串流、NIEA 動態對數迴歸、PBL & SROI (Tab 5)
  // ============================================================
  function streamModbusPackets() {
    if (!state.isModbusStreaming) return;
    const box = document.getElementById('modbus-stream-box');
    if (!box) return;

    const addr = Math.random() > 0.5 ? '01' : '02';
    const isPh = Math.random() > 0.5;
    const timeStr = getTimeString();
    const hexStr = isPh
      ? `TX [${addr} 03 00 00 00 02 C4 0B] ➔ RX [${addr} 03 04 02 C7 00 00 9A 41]`
      : `TX [${addr} 03 00 02 00 02 65 C9] ➔ RX [${addr} 03 04 02 C6 02 C6 AD 88]`;
    const desc = isPh
      ? `讀取 HUB485-${addr} pH485 (${state.cleanWaterPh.toFixed(2)} pH)`
      : `讀取 HUB485-${addr} ORP485 (${Math.round(state.cleanWaterOrp)} mV | Cl₂ ${state.freeChlorine.toFixed(2)} mg/L)`;

    const line = document.createElement('div');
    line.className = 'modbus-line';
    line.innerHTML = `<span class="modbus-time">[${timeStr}]</span> <span class="modbus-hex">${hexStr}</span> <span class="modbus-desc">${desc}</span>`;
    box.appendChild(line);
    box.scrollTop = box.scrollHeight;
    while (box.children.length > 36) box.removeChild(box.firstChild);
  }
  setInterval(streamModbusPackets, 1500);

  document.getElementById('btn-toggle-modbus')?.addEventListener('click', (e) => {
    state.isModbusStreaming = !state.isModbusStreaming;
    window.Water3DManager?.setModbusStreaming(state.isModbusStreaming);
    e.currentTarget.innerHTML = state.isModbusStreaming
      ? '<i class="fa-solid fa-pause"></i> 暫停串流'
      : '<i class="fa-solid fa-play"></i> 恢復串流';
  });

  // NIEA True Logarithmic Least-Squares Regression
  let chartRegInstance = null;
  function renderRegressionChart() {
    const ctx = document.getElementById('chartRegression');
    if (!ctx) return;

    const pts = state.dpdLabData.filter(d => d.chlorine > 0);
    const n = pts.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    pts.forEach(p => {
      const lx = Math.log(p.chlorine);
      sumX += lx;
      sumY += p.orp;
      sumXY += lx * p.orp;
      sumXX += lx * lx;
    });

    const a = (n * sumXY - sumX * sumY) / ((n * sumXX - sumX * sumX) || 1);
    const b = (sumY - a * sumX) / (n || 1);

    const meanY = sumY / (n || 1);
    let ssTot = 0, ssRes = 0;
    pts.forEach(p => {
      const pred = a * Math.log(p.chlorine) + b;
      ssTot += Math.pow(p.orp - meanY, 2);
      ssRes += Math.pow(p.orp - pred, 2);
    });
    const r2 = ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 1;

    document.getElementById('equation-text').textContent = `ORP (mV) = ${a.toFixed(1)} × ln(DPD) + ${b.toFixed(1)}`;
    document.getElementById('r2-score-text').textContent = `決定係數 R² = ${r2.toFixed(4)} (${r2 > 0.9 ? '高度相關' : '中度相關'})`;

    if (chartRegInstance) chartRegInstance.destroy();
    chartRegInstance = new Chart(ctx, {
      type: 'scatter',
      data: {
        datasets: [{
          label: 'NIEA DPD 人工採樣點',
          data: pts.map(d => ({ x: d.chlorine, y: d.orp })),
          backgroundColor: '#00f2fe',
          borderColor: '#38bdf8',
          pointRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#fff', font: { size: 10 } } } },
        scales: {
          x: { title: { display: true, text: 'DPD 餘氯 (mg/L)', color: '#94a3b8' }, ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.06)' } },
          y: { title: { display: true, text: '線上 ORP (mV)', color: '#94a3b8' }, ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.06)' } }
        }
      }
    });
  }

  document.getElementById('btn-add-dpd-point')?.addEventListener('click', () => {
    const dpdVal = parseFloat(document.getElementById('input-dpd-val')?.value);
    let orpVal = parseFloat(document.getElementById('input-orp-val')?.value);
    if (isNaN(orpVal)) orpVal = Math.round(state.cleanWaterOrp);
    if (!isNaN(dpdVal) && dpdVal > 0) {
      state.dpdLabData.push({ chlorine: dpdVal, orp: orpVal });
      renderRegressionChart();
      document.getElementById('input-dpd-val').value = '';
      document.getElementById('input-orp-val').value = '';
    } else {
      alert('請輸入大於 0 的自由餘氯數值 (mg/L)！');
    }
  });

  document.getElementById('btn-reset-dpd-points')?.addEventListener('click', () => {
    state.dpdLabData = [
      { chlorine: 0.25, orp: 610 },
      { chlorine: 0.40, orp: 660 },
      { chlorine: 0.58, orp: 710 },
      { chlorine: 0.75, orp: 750 },
      { chlorine: 0.90, orp: 785 }
    ];
    renderRegressionChart();
  });

  document.getElementById('btn-start-pbl-challenge')?.addEventListener('click', () => {
    switchToTab('tab-chlorine-game');
    startQuest('QUEST_1');
  });

  // SROI Calculator
  function calculateSROI() {
    const capital = parseFloat(document.getElementById('sroi-input-capital')?.value) || 420000;
    const fines = parseFloat(document.getElementById('sroi-input-fines')?.value) || 0;
    const savings = parseFloat(document.getElementById('sroi-input-savings')?.value) || 0;
    const maintenance = parseFloat(document.getElementById('sroi-input-maintenance')?.value) || 0;
    const student = parseFloat(document.getElementById('sroi-input-student')?.value) || 0;

    const total = fines + savings + maintenance + student;
    const ratio = capital > 0 ? total / capital : 0;

    document.getElementById('sroi-ratio-display').textContent = `SROI = ${ratio.toFixed(2)} : 1`;
    document.getElementById('sroi-total-outcomes').textContent = `NT$ ${Math.round(total).toLocaleString()}`;
    const st = document.getElementById('sroi-status-text');
    st.textContent = ratio >= 2.5
      ? `🌟 卓越評等：每投入 1 元資本，創造 ${ratio.toFixed(2)} 元社會效益`
      : ratio >= 1.5
      ? `✅ 良好評等：每投入 1 元資本，創造 ${ratio.toFixed(2)} 元社會效益`
      : `⚠️ 基礎評等：每投入 1 元資本，創造 ${ratio.toFixed(2)} 元社會效益`;
    st.style.color = ratio >= 2.5 ? 'var(--accent-green)' : ratio >= 1.5 ? 'var(--primary-cyan)' : 'var(--accent-amber)';

    const chemPct = Math.round((savings / 120000) * 20);
    const powerPct = state.energySummary.savingPct || 16.8;
    document.getElementById('sroi-esg-rates').textContent = `節藥 ${chemPct}% | 節電 ${powerPct}%`;
  }

  ['sroi-input-capital', 'sroi-input-fines', 'sroi-input-savings', 'sroi-input-maintenance', 'sroi-input-student'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => {
      document.getElementById('sroi-preset-select').value = 'custom';
      calculateSROI();
    });
  });

  document.getElementById('sroi-preset-select')?.addEventListener('change', (e) => {
    const presets = {
      baseline: [420000, 300000, 120000, 80000, 700000],
      conservative: [420000, 150000, 80000, 40000, 486000],
      optimistic: [420000, 400000, 160000, 100000, 852000]
    };
    const p = presets[e.target.value];
    if (!p) return;
    ['sroi-input-capital', 'sroi-input-fines', 'sroi-input-savings', 'sroi-input-maintenance', 'sroi-input-student'].forEach((id, i) => {
      document.getElementById(id).value = p[i];
    });
    calculateSROI();
  });

  // ============================================================
  // 14. 系統啟動初始化 Initial Boot
  // ============================================================
  updateModeButtonsUI();
  calcPhSpeciation(7.2, 0.60);
  syncUI();
  calculateSROI();

  // 自動載入範例歷史資料至監控面與報表
  fetch('sample_data.csv')
    .then(res => (res.ok ? res.text() : EMBEDDED_SAMPLE_CSV))
    .then(txt => {
      state.importedData = parseCSVToRecords(txt);
      renderImportedAndQCTables();
    })
    .catch(() => {
      state.importedData = parseCSVToRecords(EMBEDDED_SAMPLE_CSV);
      renderImportedAndQCTables();
    });
});
