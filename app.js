/* 輔英科技大學 水源地水質自動監控系統 - 核心邏輯與互動邏輯 */

document.addEventListener('DOMContentLoaded', () => {
  
  // ============================================================
  // 全域系統狀態 Global State
  // ============================================================
  const state = {
    ctrlMode: 'AUTO', // 'AUTO' or 'MANUAL'
    sedimentationPh: 7.14,
    sedimentationOrp: 485,
    cleanWaterPh: 7.35,
    cleanWaterOrp: 710,
    cleanWaterLevel: 'NORMAL', // 'NORMAL', 'LOW', 'HIGH'
    pumpAStatus: 'RUNNING',
    pumpBStatus: 'STOPPED',
    dosingPumpStatus: 'RUNNING',
    airCleanPulse: false,
    hoursPumpA: 142.5,
    hoursPumpB: 139.2,
    lastActivePump: 'A',
    isModbusStreaming: true,
    dpdLabData: [
      { chlorine: 0.25, orp: 610 },
      { chlorine: 0.40, orp: 660 },
      { chlorine: 0.58, orp: 710 },
      { chlorine: 0.75, orp: 750 },
      { chlorine: 0.90, orp: 785 }
    ],
    importedData: [],
    eventLogs: []
  };

  // ============================================================
  // 分頁切換 Tab Navigation
  // ============================================================
  const tabs = document.querySelectorAll('.nav-tab');
  const panels = document.querySelectorAll('.tab-panel');

  function switchToTab(tabId) {
    tabs.forEach(t => {
      if (t.dataset.tab === tabId) t.classList.add('active');
      else t.classList.remove('active');
    });

    panels.forEach(p => {
      if (p.id === tabId) p.classList.add('active');
      else p.classList.remove('active');
    });

    // Re-render charts when entering specific tabs
    if (tabId === 'tab-reports') {
      renderLongTermChart();
    } else if (tabId === 'tab-education') {
      renderRegressionChart();
    } else if (tabId === 'tab-chlorine-game') {
      renderChlorineGameChart();
    } else if (tabId === 'tab-speciation-game') {
      renderPhSpeciationChart();
      if (chartPhSpeciationInstance) {
        chartPhSpeciationInstance.resize();
      }
    }
  }

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      switchToTab(tab.dataset.tab);
    });
  });

  // ============================================================
  // 時間與即時狀態更新 Clock & Status Loop
  // ============================================================
  function updateTime() {
    const timeEl = document.getElementById('current-time');
    if (timeEl) {
      const now = new Date();
      timeEl.textContent = now.getFullYear() + '-' +
        String(now.getMonth() + 1).padStart(2, '0') + '-' +
        String(now.getDate()).padStart(2, '0') + ' ' +
        String(now.getHours()).padStart(2, '0') + ':' +
        String(now.getMinutes()).padStart(2, '0') + ':' +
        String(now.getSeconds()).padStart(2, '0');
    }
  }
  setInterval(updateTime, 1000);
  updateTime();

  // ============================================================
  // 推算自由有效餘氯 (DPD 迴歸) Free Chlorine Calculation
  // ORP(mV) = 145.2 * ln(Chlorine) + 788.4  => Chlorine = exp((ORP - 788.4) / 145.2)
  // ============================================================
  function calculateFreeChlorine(orp) {
    const chlorine = Math.exp((orp - 788.4) / 145.2);
    return Math.max(0.1, Math.min(2.0, parseFloat(chlorine.toFixed(2))));
  }

  // ============================================================
  // UI 畫面同步與 HMI 渲染 UI Sync Loop
  // ============================================================
  function syncUI() {
    // 頂部指標卡
    document.getElementById('val-sed-ph').innerHTML = `${state.sedimentationPh.toFixed(2)} <span class="metric-unit">pH</span>`;
    document.getElementById('val-sed-orp').innerHTML = `${Math.round(state.sedimentationOrp)} <span class="metric-unit">mV</span>`;
    document.getElementById('val-clean-ph').innerHTML = `${state.cleanWaterPh.toFixed(2)} <span class="metric-unit">pH</span>`;
    document.getElementById('val-clean-orp').innerHTML = `${Math.round(state.cleanWaterOrp)} <span class="metric-unit">mV</span>`;
    
    const chlorineVal = calculateFreeChlorine(state.cleanWaterOrp);
    document.getElementById('val-clean-chlorine').textContent = chlorineVal;

    // 泵浦運轉狀態與時數
    document.getElementById('hrs-pump-a').textContent = state.hoursPumpA.toFixed(1);
    document.getElementById('hrs-pump-b').textContent = state.hoursPumpB.toFixed(1);
    
    let pumpText = '停止中';
    if (state.pumpAStatus === 'RUNNING' && state.pumpBStatus === 'RUNNING') {
      pumpText = 'Pump A/B 雙泵運轉';
    } else if (state.pumpAStatus === 'RUNNING') {
      pumpText = 'Pump A 運轉中';
    } else if (state.pumpBStatus === 'RUNNING') {
      pumpText = 'Pump B 運轉中';
    }
    document.getElementById('val-pump-status').textContent = pumpText;

    // 現場控制器開關同步
    document.getElementById('ctrl-relay-1').checked = (state.pumpAStatus === 'RUNNING');
    document.getElementById('ctrl-relay-2').checked = (state.pumpBStatus === 'RUNNING');
    document.getElementById('ctrl-relay-3').checked = (state.dosingPumpStatus === 'RUNNING');
    document.getElementById('ctrl-relay-4').checked = state.airCleanPulse;

    // SVG HMI 動畫與顏色同步
    const animPumpA = document.getElementById('anim-pump-a');
    const animPumpB = document.getElementById('anim-pump-b');
    const animPumpDose = document.getElementById('anim-pump-dose');

    if (animPumpA) {
      if (state.pumpAStatus === 'RUNNING') animPumpA.classList.remove('pump-stopped');
      else animPumpA.classList.add('pump-stopped');
    }
    if (animPumpB) {
      if (state.pumpBStatus === 'RUNNING') animPumpB.classList.remove('pump-stopped');
      else animPumpB.classList.add('pump-stopped');
    }
    if (animPumpDose) {
      if (state.dosingPumpStatus === 'RUNNING') animPumpDose.classList.remove('pump-stopped');
      else animPumpDose.classList.add('pump-stopped');
    }

    // SVG Relays LED 點亮
    setSvgElementColor('svg-relay-1', state.pumpAStatus === 'RUNNING' ? '#10b981' : '#64748b');
    setSvgElementColor('svg-relay-2', state.pumpBStatus === 'RUNNING' ? '#10b981' : '#64748b');
    setSvgElementColor('svg-relay-3', state.dosingPumpStatus === 'RUNNING' ? '#10b981' : '#64748b');
    setSvgElementColor('svg-relay-4', state.airCleanPulse ? '#00f2fe' : '#64748b');

    // 警報狀態卡片顏色評估
    const cardCleanOrp = document.getElementById('card-clean-orp');
    const cardCleanPh = document.getElementById('card-clean-ph');

    if (state.cleanWaterOrp < 650) {
      cardCleanOrp.className = 'metric-card red';
    } else {
      cardCleanOrp.className = 'metric-card green';
    }

    if (state.cleanWaterPh < 6.0 || state.cleanWaterPh > 8.5) {
      cardCleanPh.className = 'metric-card red';
    } else {
      cardCleanPh.className = 'metric-card green';
    }
  }

  function setSvgElementColor(id, color) {
    const el = document.getElementById(id);
    if (el) el.setAttribute('fill', color);
  }

  // ============================================================
  // 控制邏輯引擎 Control Logic Engine (自動交替 & 互鎖加藥)
  // ============================================================
  function runControlLogic() {
    if (state.ctrlMode === 'AUTO') {
      // 若水位過低，自動交替啟動砂濾泵
      if (state.cleanWaterLevel === 'LOW') {
        if (state.lastActivePump === 'A') {
          state.pumpAStatus = 'STOPPED';
          state.pumpBStatus = 'RUNNING';
          state.lastActivePump = 'B';
        } else {
          state.pumpAStatus = 'RUNNING';
          state.pumpBStatus = 'STOPPED';
          state.lastActivePump = 'A';
        }
        state.cleanWaterLevel = 'NORMAL'; // 補水中
        addEventLog('AUTO_LOGIC', `清水池水位過低，DO4 自動切換啟動砂濾泵 ${state.lastActivePump}`);
      } else if (state.cleanWaterLevel === 'HIGH') {
        state.pumpAStatus = 'STOPPED';
        state.pumpBStatus = 'STOPPED';
        addEventLog('AUTO_LOGIC', '清水池水位已滿，自動停泵');
      }

      // 加藥泵連動邏輯：任一台砂濾泵啟動（水流建立）時，加藥泵同步啟動
      if (state.pumpAStatus === 'RUNNING' || state.pumpBStatus === 'RUNNING') {
        state.dosingPumpStatus = 'RUNNING';
      } else {
        state.dosingPumpStatus = 'STOPPED';
      }
    }

    // 累積馬達時數
    if (state.pumpAStatus === 'RUNNING') state.hoursPumpA += (1 / 3600);
    if (state.pumpBStatus === 'RUNNING') state.hoursPumpB += (1 / 3600);

    // 水質動態與加藥反應 simulation
    if (state.dosingPumpStatus === 'RUNNING') {
      if (state.cleanWaterOrp < 710) state.cleanWaterOrp += 0.5;
    } else {
      if (state.cleanWaterOrp > 600) state.cleanWaterOrp -= 0.3;
    }

    // 警報檢查
    if (state.cleanWaterOrp < 650) {
      addEventLog('ALARM', `清水池 ORP (${Math.round(state.cleanWaterOrp)}mV < 650mV) 警報：消毒效能不足！`);
    }

    syncUI();
  }
  setInterval(runControlLogic, 2000);

  // ============================================================
  // 事件與警報日誌 Event Logging System
  // ============================================================
  function addEventLog(type, msg) {
    const container = document.getElementById('event-log-container');
    if (!container) return;

    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
    
    let hexTag = 'INFO';
    if (type === 'ALARM') hexTag = '<span style="color:#ef4444; font-weight:bold;">ALARM</span>';
    else if (type === 'AUTO_LOGIC') hexTag = '<span style="color:#38bdf8;">CTRL_LOGIC</span>';
    else if (type === 'AIR_CLEAN') hexTag = '<span style="color:#00f2fe;">AIR_CLEAN</span>';

    const line = document.createElement('div');
    line.className = 'modbus-line';
    line.innerHTML = `<span class="modbus-time">[${timeStr}]</span> <span class="modbus-hex">${hexTag}</span> <span class="modbus-desc">${msg}</span>`;

    container.insertBefore(line, container.firstChild);
    if (container.children.length > 50) {
      container.removeChild(container.lastChild);
    }
  }

  // ============================================================
  // 現場可動化控制器面板事件 Field Controller Interactions
  // ============================================================
  const switchAutoManual = document.getElementById('switch-auto-manual');
  if (switchAutoManual) {
    switchAutoManual.addEventListener('change', (e) => {
      state.ctrlMode = e.target.checked ? 'AUTO' : 'MANUAL';
      const textMode = document.getElementById('text-ctrl-mode');
      if (textMode) {
        textMode.textContent = state.ctrlMode === 'AUTO' ? 'AUTO (自動交替)' : 'MANUAL (現場手動)';
        textMode.style.color = state.ctrlMode === 'AUTO' ? 'var(--accent-green)' : 'var(--accent-amber)';
      }
      addEventLog('INFO', `控制模式切換為: ${state.ctrlMode}`);
    });
  }

  // Relay 手動切換
  document.getElementById('ctrl-relay-1')?.addEventListener('change', (e) => {
    state.pumpAStatus = e.target.checked ? 'RUNNING' : 'STOPPED';
    syncUI();
  });
  document.getElementById('ctrl-relay-2')?.addEventListener('change', (e) => {
    state.pumpBStatus = e.target.checked ? 'RUNNING' : 'STOPPED';
    syncUI();
  });
  document.getElementById('ctrl-relay-3')?.addEventListener('change', (e) => {
    state.dosingPumpStatus = e.target.checked ? 'RUNNING' : 'STOPPED';
    syncUI();
  });
  document.getElementById('ctrl-relay-4')?.addEventListener('change', (e) => {
    state.airCleanPulse = e.target.checked;
    syncUI();
  });

  // DI 按鈕模擬
  document.getElementById('btn-sim-low-level')?.addEventListener('click', () => {
    state.cleanWaterLevel = 'LOW';
    addEventLog('INFO', '手動模擬觸發 DI1：清水池水位過低');
    runControlLogic();
  });

  document.getElementById('btn-sim-high-level')?.addEventListener('click', () => {
    state.cleanWaterLevel = 'HIGH';
    addEventLog('INFO', '手動模擬觸發 DI1：清水池水位過高 (水滿)');
    runControlLogic();
  });

  // 手動觸發 12VDC 電極空氣清洗
  document.getElementById('btn-trigger-air-clean')?.addEventListener('click', () => {
    state.airCleanPulse = true;
    syncUI();
    addEventLog('AIR_CLEAN', '觸發 12VDC 空氣泵噴氣 30 秒，自動清洗沉澱池與清水池 pH/ORP 電極膜！');

    setTimeout(() => {
      state.airCleanPulse = false;
      syncUI();
      addEventLog('AIR_CLEAN', '電極噴氣清洗完成，自動恢復常態監測。');
    }, 5000); // 5s demo pulse
  });

  // 微調滑桿
  const sliderPh = document.getElementById('slider-ph');
  if (sliderPh) {
    sliderPh.addEventListener('input', (e) => {
      state.sedimentationPh = parseFloat(e.target.value);
      state.cleanWaterPh = parseFloat((state.sedimentationPh + 0.2).toFixed(2));
      document.getElementById('slider-val-ph').textContent = `${state.sedimentationPh.toFixed(2)} pH`;
      syncUI();
    });
  }

  const sliderOrp = document.getElementById('slider-orp');
  if (sliderOrp) {
    sliderOrp.addEventListener('input', (e) => {
      state.sedimentationOrp = parseInt(e.target.value);
      state.cleanWaterOrp = state.sedimentationOrp + 225; // post chlorination boost
      document.getElementById('slider-val-orp').textContent = `${state.sedimentationOrp} mV`;
      syncUI();
    });
  }

  // ============================================================
  // Tab 3: Modbus RTU 封包串流模擬器 (物聯網實作教學)
  // ============================================================
  function streamModbusPackets() {
    if (!state.isModbusStreaming) return;
    const box = document.getElementById('modbus-stream-box');
    if (!box) return;

    const addresses = ['01', '02']; // HUB1 (Sedimentation), HUB2 (Clean Water)
    const randomAddr = addresses[Math.floor(Math.random() * addresses.length)];
    const isPh = Math.random() > 0.5;

    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

    let hexStr = '';
    let desc = '';

    if (isPh) {
      hexStr = `TX [${randomAddr} 03 00 00 00 02 C4 0B] ➔ RX [${randomAddr} 03 04 02 C7 00 00 9A 41]`;
      desc = `讀取 ADDR ${randomAddr} pH485 計數器 (數值: ${(state.cleanWaterPh).toFixed(2)} pH)`;
    } else {
      hexStr = `TX [${randomAddr} 03 00 02 00 02 65 C9] ➔ RX [${randomAddr} 03 04 02 C6 02 C6 AD 88]`;
      desc = `讀取 ADDR ${randomAddr} ORP485 計數器 (數值: ${Math.round(state.cleanWaterOrp)} mV)`;
    }

    const line = document.createElement('div');
    line.className = 'modbus-line';
    line.innerHTML = `<span class="modbus-time">[${timeStr}]</span> <span class="modbus-hex">${hexStr}</span> <span class="modbus-desc">${desc}</span>`;
    
    box.appendChild(line);
    box.scrollTop = box.scrollHeight;

    if (box.children.length > 40) box.removeChild(box.firstChild);
  }
  setInterval(streamModbusPackets, 1500);

  document.getElementById('btn-toggle-modbus')?.addEventListener('click', (e) => {
    state.isModbusStreaming = !state.isModbusStreaming;
    e.target.innerHTML = state.isModbusStreaming ? '<i class="fa-solid fa-pause"></i> 暫停串流' : '<i class="fa-solid fa-play"></i> 恢復串流';
  });

  // ============================================================
  // Tab 3: NIEA 實驗對比對數迴歸圖表
  // ============================================================
  let chartRegInstance = null;
  function renderRegressionChart() {
    const ctx = document.getElementById('chartRegression');
    if (!ctx) return;

    if (chartRegInstance) chartRegInstance.destroy();

    const dataPoints = state.dpdLabData.map(d => ({ x: d.chlorine, y: d.orp }));

    chartRegInstance = new Chart(ctx, {
      type: 'scatter',
      data: {
        datasets: [{
          label: 'NIEA DPD 人工採樣點',
          data: dataPoints,
          backgroundColor: '#00f2fe',
          borderColor: '#38bdf8',
          pointRadius: 6,
          pointHoverRadius: 8
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { labels: { color: '#fff' } }
        },
        scales: {
          x: {
            title: { display: true, text: 'DPD 自由餘氯 (mg/L)', color: '#94a3b8' },
            ticks: { color: '#94a3b8' },
            grid: { color: 'rgba(255,255,255,0.05)' }
          },
          y: {
            title: { display: true, text: '線上 ORP (mV)', color: '#94a3b8' },
            ticks: { color: '#94a3b8' },
            grid: { color: 'rgba(255,255,255,0.05)' }
          }
        }
      }
    });
  }

  document.getElementById('btn-add-dpd-point')?.addEventListener('click', () => {
    const dpdInput = document.getElementById('input-dpd-val');
    const orpInput = document.getElementById('input-orp-val');

    const dpdVal = parseFloat(dpdInput.value);
    let orpVal = parseFloat(orpInput.value);

    if (isNaN(orpVal)) {
      orpVal = Math.round(state.cleanWaterOrp);
    }

    if (!isNaN(dpdVal) && dpdVal > 0) {
      state.dpdLabData.push({ chlorine: dpdVal, orp: orpVal });
      renderRegressionChart();
      alert(`已成功新增 NIEA 實驗對比數據點：\n自由餘氯: ${dpdVal} mg/L, 線上 ORP: ${orpVal} mV！`);
      dpdInput.value = '';
      orpInput.value = '';
    } else {
      alert('請填入有效的自由餘氯數值 (mg/L)！');
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
    alert('已重置為標準對比數據庫！');
  });

  // ============================================================
  // Tab 3: PBL 闖關遊戲
  // ============================================================
  document.getElementById('btn-start-pbl-challenge')?.addEventListener('click', () => {
    state.sedimentationPh = 6.2;
    state.sedimentationOrp = 410;
    state.cleanWaterOrp = 620;
    syncUI();

    alert('🚨 觸發 PBL 闖關情境：「大雨過後原水有機物暴增」！\n\n當前清水池 ORP 已降至 620mV (消毒失效)！\n請進入【現場可動化控制面板】，調整加藥泵與過濾切換，將 ORP 恢復至 650mV 以上！');
  });

  // ============================================================
  // Tab 3: SROI 社會投資報酬率與 ESG 動態計算器
  // ============================================================
  function calculateSROI() {
    const capital = parseFloat(document.getElementById('sroi-input-capital')?.value) || 420000;
    const fines = parseFloat(document.getElementById('sroi-input-fines')?.value) || 0;
    const savings = parseFloat(document.getElementById('sroi-input-savings')?.value) || 0;
    const maintenance = parseFloat(document.getElementById('sroi-input-maintenance')?.value) || 0;
    const student = parseFloat(document.getElementById('sroi-input-student')?.value) || 0;

    const totalOutcomes = fines + savings + maintenance + student;
    const sroiRatio = capital > 0 ? (totalOutcomes / capital) : 0;

    const ratioDisplay = document.getElementById('sroi-ratio-display');
    const totalDisplay = document.getElementById('sroi-total-outcomes');
    const statusDisplay = document.getElementById('sroi-status-text');
    const esgDisplay = document.getElementById('sroi-esg-rates');

    if (ratioDisplay) {
      ratioDisplay.textContent = `SROI = ${sroiRatio.toFixed(2)} : 1`;
    }
    if (totalDisplay) {
      totalDisplay.textContent = `NT$ ${Math.round(totalOutcomes).toLocaleString()}`;
    }

    if (statusDisplay) {
      if (sroiRatio >= 2.5) {
        statusDisplay.textContent = `🌟 卓越評等：每投入 1 元資本，創造 ${sroiRatio.toFixed(2)} 元社會效益`;
        statusDisplay.style.color = 'var(--accent-green)';
      } else if (sroiRatio >= 1.5) {
        statusDisplay.textContent = `✅ 良好評等：每投入 1 元資本，創造 ${sroiRatio.toFixed(2)} 元社會效益`;
        statusDisplay.style.color = 'var(--primary-cyan)';
      } else {
        statusDisplay.textContent = `⚠️ 基礎評等：每投入 1 元資本，創造 ${sroiRatio.toFixed(2)} 元社會效益`;
        statusDisplay.style.color = 'var(--accent-amber)';
      }
    }

    if (esgDisplay) {
      const chemPct = Math.round((savings / 120000) * 20);
      const powerPct = Math.round((savings / 120000) * 15);
      esgDisplay.textContent = `節藥 ${chemPct}% | 節電 ${powerPct}%`;
    }
  }

  // 監聽數值欄位輸入
  ['sroi-input-capital', 'sroi-input-fines', 'sroi-input-savings', 'sroi-input-maintenance', 'sroi-input-student'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => {
      const presetSelect = document.getElementById('sroi-preset-select');
      if (presetSelect) presetSelect.value = 'custom';
      calculateSROI();
    });
  });

  // 預設下拉選單切換
  document.getElementById('sroi-preset-select')?.addEventListener('change', (e) => {
    const val = e.target.value;
    if (val === 'baseline') {
      document.getElementById('sroi-input-capital').value = 420000;
      document.getElementById('sroi-input-fines').value = 300000;
      document.getElementById('sroi-input-savings').value = 120000;
      document.getElementById('sroi-input-maintenance').value = 80000;
      document.getElementById('sroi-input-student').value = 700000;
    } else if (val === 'conservative') {
      document.getElementById('sroi-input-capital').value = 420000;
      document.getElementById('sroi-input-fines').value = 150000;
      document.getElementById('sroi-input-savings').value = 80000;
      document.getElementById('sroi-input-maintenance').value = 40000;
      document.getElementById('sroi-input-student').value = 486000;
    } else if (val === 'optimistic') {
      document.getElementById('sroi-input-capital').value = 420000;
      document.getElementById('sroi-input-fines').value = 400000;
      document.getElementById('sroi-input-savings').value = 160000;
      document.getElementById('sroi-input-maintenance').value = 100000;
      document.getElementById('sroi-input-student').value = 852000;
    }
    calculateSROI();
  });

  calculateSROI();

  // ============================================================
  // Tab 4: 載入範例 CSV 數據與拖曳上傳
  // ============================================================
  const btnLoadSample = document.getElementById('btn-load-sample');
  if (btnLoadSample) {
    btnLoadSample.addEventListener('click', () => {
      fetch('sample_data.csv')
        .then(res => res.text())
        .then(csvText => {
          parseAndRenderCSV(csvText);
          alert('成功載入計畫範例歷史數據 sample_data.csv！');
        })
        .catch(err => {
          alert('載入 sample_data.csv 失敗: ' + err);
        });
    });
  }

  function parseAndRenderCSV(csvText) {
    const lines = csvText.trim().split('\n');
    if (lines.length <= 1) return;

    const headers = lines[0].split(',');
    const rows = lines.slice(1).map(line => line.split(','));
    state.importedData = rows;

    const tbody = document.getElementById('table-imported-body');
    const tbodyStatutory = document.getElementById('table-statutory-body');

    if (tbody) {
      tbody.innerHTML = rows.slice(0, 15).map(r => `
        <tr>
          <td>${r[0]}</td>
          <td>${r[1]}</td>
          <td>${r[2]}</td>
          <td>${r[3]}</td>
          <td>${r[4]}</td>
          <td>${r[9]}</td>
          <td><span class="status-badge" style="background:rgba(16,185,129,0.1); color:#10b981;">${r[6]}</span></td>
          <td><span class="status-badge" style="background:rgba(255,255,255,0.05); color:#94a3b8;">${r[7]}</span></td>
          <td>${r[12] || ''}</td>
        </tr>
      `).join('');
    }

    if (tbodyStatutory) {
      tbodyStatutory.innerHTML = rows.slice(0, 10).map(r => `
        <tr>
          <td>${r[0].split(' ')[0]}</td>
          <td>${r[1]}</td>
          <td>${r[2]}</td>
          <td>${r[3]}</td>
          <td>${r[4]}</td>
          <td>${r[9]}</td>
          <td>${r[10] === '1' ? '已執行噴氣' : '常態監測'}</td>
          <td><strong style="color:green;">合格</strong></td>
          <td>環工系 / 營繕組 覆核</td>
        </tr>
      `).join('');
    }
  }

  // 自動載入預設數據
  fetch('sample_data.csv')
    .then(res => res.text())
    .then(csvText => parseAndRenderCSV(csvText))
    .catch(() => {});

  // ============================================================
  // Tab 5: 長期數據折線圖 (Chart.js)
  // ============================================================
  let chartLongTermInstance = null;
  function renderLongTermChart() {
    const ctx = document.getElementById('chartLongTerm');
    if (!ctx) return;

    if (chartLongTermInstance) chartLongTermInstance.destroy();

    const labels = state.importedData.length ? state.importedData.map(r => r[0].split(' ')[1] || r[0]) : ['00:00', '02:00', '04:00', '06:00', '08:00', '10:00', '12:00'];
    const sedOrp = state.importedData.length ? state.importedData.map(r => parseFloat(r[2])) : [485, 482, 488, 490, 486, 480, 484];
    const cleanOrp = state.importedData.length ? state.importedData.map(r => parseFloat(r[4])) : [710, 708, 715, 712, 710, 705, 711];

    chartLongTermInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: '清水池 ORP (出水消毒指標)',
            data: cleanOrp,
            borderColor: '#00f2fe',
            backgroundColor: 'rgba(0, 242, 254, 0.1)',
            fill: true,
            tension: 0.3
          },
          {
            label: '沉澱池 ORP (原水總氧化力)',
            borderColor: '#f59e0b',
            data: sedOrp,
            backgroundColor: 'transparent',
            borderDash: [5, 5],
            tension: 0.3
          }
        ]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { labels: { color: '#fff' } }
        },
        scales: {
          x: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.05)' } },
          y: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.05)' } }
        }
      }
    });
  }

  // 匯出 CSV 檔案
  document.getElementById('btn-export-csv')?.addEventListener('click', () => {
    let csvContent = 'data:text/csv;charset=utf-8,Timestamp,Sedimentation_pH,Sedimentation_ORP,CleanWater_pH,CleanWater_ORP,Free_Chlorine_mgL,Compliance_Status\n';
    
    if (state.importedData.length) {
      state.importedData.forEach(row => {
        csvContent += row.join(',') + '\n';
      });
    } else {
      csvContent += `2026-09-12 06:00:00,7.14,485,7.35,710,0.58,PASS\n`;
    }

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', 'Fooyin_Water_Quality_Statutory_Report_2026.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  });

  // ============================================================
  // Tab 6: 加氯 / 減氯水質控制互動遊戲核心邏輯 (Chlorine Game Engine)
  // ============================================================
  const gameState = {
    mode: 'SANDBOX', // 'SANDBOX', 'QUEST_1', 'QUEST_2', 'QUEST_3'
    score: 100,
    timeLeft: 0,
    timerInterval: null,
    naoclRate: 35, // mL/min
    nahso3Rate: 0, // mL/min
    inflow: 50, // L/min
    organicLoad: 0, // 0 to 1.5
    chlorine: 0.58, // mg/L
    orp: 710, // mV
    ph: 7.35, // pH
    thm: 8, // ppb
    pathogenProtection: 99.99, // %
    questTargetTime: 0,
    questTimeInZone: 0,
    history: {
      labels: [],
      chlorine: [],
      naocl: [],
      nahso3: []
    }
  };

  let chartChlorineInstance = null;

  function renderChlorineGameChart() {
    const ctx = document.getElementById('chartChlorineGame');
    if (!ctx) return;
    if (chartChlorineInstance) return;

    chartChlorineInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: gameState.history.labels,
        datasets: [
          {
            label: '自由有效餘氯 Free Cl₂ (mg/L)',
            data: gameState.history.chlorine,
            borderColor: '#00f2fe',
            borderWidth: 3,
            backgroundColor: 'rgba(0, 242, 254, 0.1)',
            fill: true,
            tension: 0.3,
            yAxisID: 'y'
          },
          {
            label: 'NaOCl 加藥量 (mL/min)',
            data: gameState.history.naocl,
            borderColor: '#38bdf8',
            borderWidth: 2,
            borderDash: [4, 4],
            backgroundColor: 'transparent',
            tension: 0.1,
            yAxisID: 'y1'
          },
          {
            label: 'NaHSO₃ 減氯量 (mL/min)',
            data: gameState.history.nahso3,
            borderColor: '#34d399',
            borderWidth: 2,
            borderDash: [2, 2],
            backgroundColor: 'transparent',
            tension: 0.1,
            yAxisID: 'y1'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: '#cbd5e1', font: { size: 11 } } }
        },
        scales: {
          x: { ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
          y: {
            title: { display: true, text: '餘氯 (mg/L)', color: '#00f2fe' },
            min: 0,
            max: 2.2,
            ticks: { color: '#00f2fe' },
            grid: { color: 'rgba(255,255,255,0.08)' }
          },
          y1: {
            position: 'right',
            title: { display: true, text: '泵流量 (mL/min)', color: '#94a3b8' },
            min: 0,
            max: 100,
            ticks: { color: '#94a3b8' },
            grid: { drawOnChartArea: false }
          }
        }
      }
    });
  }

  function updateChlorineGamePhysics() {
    // 1. Calculate Chlorine Addition Rate
    // Base addition: 35 mL/min at 50 L/min inflow => +0.012 mg/L per sec
    const naoclInput = (gameState.naoclRate / 35) * 0.012 * (50 / gameState.inflow);

    // 2. Calculate Dechlorination Neutralization Rate
    // 30 mL/min NaHSO3 neutralizes ~0.018 mg/L per sec
    const nahso3Neutralization = (gameState.nahso3Rate / 30) * 0.018;

    // 3. Organic Demand (Storm runoff)
    const organicConsumption = gameState.organicLoad * 0.022;

    // 4. Baseline water flow decay
    const baseDecay = 0.003;

    // Net delta chlorine
    const delta = naoclInput - nahso3Neutralization - organicConsumption - baseDecay;
    gameState.chlorine = Math.max(0.01, Math.min(2.5, gameState.chlorine + delta));

    // Calculate ORP from Chlorine
    if (gameState.chlorine <= 0.02) {
      gameState.orp = 450;
    } else {
      gameState.orp = Math.round(145.2 * Math.log(gameState.chlorine) + 788.4);
      gameState.orp = Math.max(420, Math.min(850, gameState.orp));
    }

    // Calculate THMs Risk (Trihalomethanes)
    if (gameState.chlorine > 1.0) {
      gameState.thm = Math.round(8 + Math.pow((gameState.chlorine - 1.0) * 12, 1.8));
    } else {
      gameState.thm = Math.max(3, Math.round(gameState.chlorine * 12));
    }

    // Calculate Pathogen Protection (%)
    if (gameState.chlorine < 0.2) {
      gameState.pathogenProtection = parseFloat((gameState.chlorine / 0.2 * 99.9).toFixed(1));
    } else {
      gameState.pathogenProtection = 99.99;
    }

    // Dynamic Tank Water SVG Colors & Animations
    const stop1 = document.getElementById('cg-grad-stop1');
    const stop2 = document.getElementById('cg-grad-stop2');
    const tankWater = document.getElementById('cg-tank-water');
    const mixerBlades = document.getElementById('cg-mixer-blades');
    const animNaoclPump = document.getElementById('anim-cg-pump-naocl');
    const animNahso3Pump = document.getElementById('anim-cg-pump-nahso3');
    const dropletNaocl = document.getElementById('droplet-naocl');
    const dropletNahso3 = document.getElementById('droplet-nahso3');

    if (stop1 && stop2) {
      if (gameState.chlorine > 1.2) {
        // Toxic Purple Alert
        stop1.setAttribute('stop-color', '#a855f7');
        stop2.setAttribute('stop-color', '#7e22ce');
        if (tankWater) tankWater.setAttribute('stroke', '#ef4444');
      } else if (gameState.chlorine < 0.2 || gameState.organicLoad > 0.5) {
        // Murky Brown Organic
        stop1.setAttribute('stop-color', '#d97706');
        stop2.setAttribute('stop-color', '#92400e');
        if (tankWater) tankWater.setAttribute('stroke', '#f59e0b');
      } else {
        // Normal Cyan Clean Water
        stop1.setAttribute('stop-color', '#0284c7');
        stop2.setAttribute('stop-color', '#0369a1');
        if (tankWater) tankWater.setAttribute('stroke', '#00f2fe');
      }
    }

    // Mixer Animation
    if (mixerBlades) {
      if (gameState.naoclRate > 0 || gameState.nahso3Rate > 0) {
        mixerBlades.classList.add('spin-mixer');
      } else {
        mixerBlades.classList.remove('spin-mixer');
      }
    }

    // Droplet Animations
    if (dropletNaocl) dropletNaocl.style.display = gameState.naoclRate > 0 ? 'block' : 'none';
    if (dropletNahso3) dropletNahso3.style.display = gameState.nahso3Rate > 0 ? 'block' : 'none';

    // SVG Readouts
    const svgClEl = document.getElementById('cg-svg-chlorine-val');
    if (svgClEl) svgClEl.textContent = `${gameState.chlorine.toFixed(2)} mg/L`;

    // Sync Cards & Badges
    syncGameMetricsUI();

    // Chart Data Push
    const now = new Date();
    const timeStr = `${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
    gameState.history.labels.push(timeStr);
    gameState.history.chlorine.push(parseFloat(gameState.chlorine.toFixed(2)));
    gameState.history.naocl.push(gameState.naoclRate);
    gameState.history.nahso3.push(gameState.nahso3Rate);

    if (gameState.history.labels.length > 25) {
      gameState.history.labels.shift();
      gameState.history.chlorine.shift();
      gameState.history.naocl.shift();
      gameState.history.nahso3.shift();
    }

    if (chartChlorineInstance) {
      chartChlorineInstance.update('none');
    }

    // Quest mode tick
    if (gameState.mode !== 'SANDBOX') {
      evaluateQuestProgress();
    }
  }
  setInterval(updateChlorineGamePhysics, 1000);

  function syncGameMetricsUI() {
    const elCl = document.getElementById('cg-metric-chlorine');
    const elSubCl = document.getElementById('cg-sub-chlorine');
    const cardCl = document.getElementById('card-cg-chlorine');
    const elOrp = document.getElementById('cg-metric-orp');
    const elThm = document.getElementById('cg-metric-thm');
    const cardThm = document.getElementById('card-cg-thm');
    const elPathogen = document.getElementById('cg-metric-pathogen');
    const badgeStatus = document.getElementById('cg-status-badge');

    if (elCl) elCl.innerHTML = `${gameState.chlorine.toFixed(2)} <span class="metric-unit">mg/L</span>`;
    if (elOrp) elOrp.innerHTML = `${gameState.orp} <span class="metric-unit">mV</span>`;
    if (elThm) elThm.innerHTML = `${gameState.thm} <span class="metric-unit">ppb</span>`;
    if (elPathogen) elPathogen.innerHTML = `${gameState.pathogenProtection} <span class="metric-unit">%</span>`;

    if (gameState.chlorine >= 0.2 && gameState.chlorine <= 1.0) {
      if (cardCl) cardCl.className = 'metric-card green';
      if (elSubCl) elSubCl.textContent = '法規合格 (0.2 ~ 1.0 mg/L)';
      if (badgeStatus) {
        badgeStatus.className = 'badge-status green';
        badgeStatus.textContent = '水質法規合規 (PASS)';
      }
    } else if (gameState.chlorine < 0.2) {
      if (cardCl) cardCl.className = 'metric-card red';
      if (elSubCl) elSubCl.textContent = '⚠️ 餘氯過低 (消毒防護不足)';
      if (badgeStatus) {
        badgeStatus.className = 'badge-status red';
        badgeStatus.textContent = '⚠️ 消毒不足警報';
      }
    } else {
      if (cardCl) cardCl.className = 'metric-card red';
      if (elSubCl) elSubCl.textContent = '⚠️ 餘氯過高 (三鹵甲烷致癌風險)';
      if (badgeStatus) {
        badgeStatus.className = 'badge-status red';
        badgeStatus.textContent = '⚠️ 過度加氯警報';
      }
    }

    if (gameState.thm > 80) {
      if (cardThm) cardThm.className = 'metric-card red';
    } else {
      if (cardThm) cardThm.className = 'metric-card purple';
    }

    const modeText = document.getElementById('cg-mode-text');
    const timerText = document.getElementById('cg-timer-display');
    const scoreText = document.getElementById('cg-score-display');

    if (scoreText) scoreText.textContent = gameState.score;
    if (timerText) timerText.textContent = gameState.mode === 'SANDBOX' ? '-- s' : `${gameState.timeLeft} s`;

    if (modeText) {
      if (gameState.mode === 'SANDBOX') modeText.textContent = '自由動態沙盒';
      else if (gameState.mode === 'QUEST_1') modeText.textContent = '關卡 1：暴雨處置';
      else if (gameState.mode === 'QUEST_2') modeText.textContent = '關卡 2：減氯中和救援';
      else if (gameState.mode === 'QUEST_3') modeText.textContent = '關卡 3：60秒動態恆定';
    }
  }

  // Sliders Event Handlers
  const sliderNaocl = document.getElementById('cg-slider-naocl');
  if (sliderNaocl) {
    sliderNaocl.addEventListener('input', (e) => {
      gameState.naoclRate = parseInt(e.target.value);
      document.getElementById('cg-val-naocl-rate').textContent = `${gameState.naoclRate} mL/min`;
    });
  }

  const sliderNahso3 = document.getElementById('cg-slider-nahso3');
  if (sliderNahso3) {
    sliderNahso3.addEventListener('input', (e) => {
      gameState.nahso3Rate = parseInt(e.target.value);
      document.getElementById('cg-val-nahso3-rate').textContent = `${gameState.nahso3Rate} mL/min`;
    });
  }

  const sliderInflow = document.getElementById('cg-slider-inflow');
  if (sliderInflow) {
    sliderInflow.addEventListener('input', (e) => {
      gameState.inflow = parseInt(e.target.value);
      document.getElementById('cg-val-inflow').textContent = `${gameState.inflow} L/min`;
    });
  }

  // Organic Spike Toggle
  document.getElementById('btn-cg-toggle-organic')?.addEventListener('click', () => {
    if (gameState.organicLoad > 0) {
      gameState.organicLoad = 0;
      addEventLog('INFO', '手動取消暴雨有機物干擾。');
    } else {
      gameState.organicLoad = 1.0;
      addEventLog('ALARM', '🌧️ 手動觸發暴雨！原水有機物暴增，氯需求 Spike！');
    }
  });

  // PBL Quest Handlers
  document.getElementById('btn-cg-sandbox')?.addEventListener('click', () => {
    startQuest('SANDBOX');
  });

  document.getElementById('btn-cg-quest-1')?.addEventListener('click', () => {
    startQuest('QUEST_1');
  });

  document.getElementById('btn-cg-quest-2')?.addEventListener('click', () => {
    startQuest('QUEST_2');
  });

  document.getElementById('btn-cg-quest-3')?.addEventListener('click', () => {
    startQuest('QUEST_3');
  });

  // Link button from tab-education "開始 PBL 闖關挑戰"
  document.getElementById('btn-start-pbl-challenge')?.addEventListener('click', () => {
    switchToTab('tab-chlorine-game');
    startQuest('QUEST_1');
  });

  // Back button from chlorine game to PBL tab
  document.getElementById('btn-back-to-pbl-1')?.addEventListener('click', () => {
    switchToTab('tab-education');
  });

  function startQuest(mode) {
    if (gameState.timerInterval) clearInterval(gameState.timerInterval);
    gameState.mode = mode;
    gameState.questTimeInZone = 0;

    if (mode === 'SANDBOX') {
      gameState.score = 100;
      gameState.timeLeft = 0;
      gameState.organicLoad = 0;
      gameState.chlorine = 0.58;
      gameState.naoclRate = 35;
      gameState.nahso3Rate = 0;
      if (sliderNaocl) sliderNaocl.value = 35;
      if (sliderNahso3) sliderNahso3.value = 0;
      document.getElementById('cg-val-naocl-rate').textContent = '35 mL/min';
      document.getElementById('cg-val-nahso3-rate').textContent = '0 mL/min';
      addEventLog('INFO', '遊戲切換至 [自由動態沙盒模式]');
      return;
    }

    if (mode === 'QUEST_1') {
      // Storm organic spike quest
      gameState.timeLeft = 30;
      gameState.score = 100;
      gameState.organicLoad = 1.2;
      gameState.chlorine = 0.08;
      gameState.naoclRate = 10;
      gameState.nahso3Rate = 0;
      if (sliderNaocl) sliderNaocl.value = 10;
      if (sliderNahso3) sliderNahso3.value = 0;
      document.getElementById('cg-val-naocl-rate').textContent = '10 mL/min';
      document.getElementById('cg-val-nahso3-rate').textContent = '0 mL/min';
      addEventLog('ALARM', '🎮 啟動關卡 1【暴雨緊急處置】：原水有機物暴增！餘氯暴跌至 0.08 mg/L，請於 30 秒內加大 NaOCl 補氯回 0.4~0.8 mg/L！');
    } else if (mode === 'QUEST_2') {
      // Over-chlorination dechlorination emergency
      gameState.timeLeft = 25;
      gameState.score = 100;
      gameState.organicLoad = 0;
      gameState.chlorine = 1.85;
      gameState.naoclRate = 90;
      gameState.nahso3Rate = 0;
      if (sliderNaocl) sliderNaocl.value = 90;
      if (sliderNahso3) sliderNahso3.value = 0;
      document.getElementById('cg-val-naocl-rate').textContent = '90 mL/min';
      document.getElementById('cg-val-nahso3-rate').textContent = '0 mL/min';
      addEventLog('ALARM', '🎮 啟動關卡 2【加藥過量減氯中和】：加藥泵過度加氯至 1.85 mg/L (致癌 THMs 警報)！請調低 NaOCl 並啟動 NaHSO₃ 減氯中和！');
    } else if (mode === 'QUEST_3') {
      // 60s stability challenge
      gameState.timeLeft = 60;
      gameState.score = 100;
      gameState.organicLoad = 0;
      gameState.chlorine = 0.55;
      gameState.naoclRate = 35;
      gameState.nahso3Rate = 0;
      if (sliderNaocl) sliderNaocl.value = 35;
      if (sliderNahso3) sliderNahso3.value = 0;
      document.getElementById('cg-val-naocl-rate').textContent = '35 mL/min';
      document.getElementById('cg-val-nahso3-rate').textContent = '0 mL/min';
      addEventLog('INFO', '🎮 啟動關卡 3【60秒動態流量恆定考驗】：將餘氯精準維持於 0.5~0.7 mg/L 達 60 秒！');
    }

    gameState.timerInterval = setInterval(() => {
      if (gameState.timeLeft > 0) {
        gameState.timeLeft--;

        // Quest 3 dynamic inflow fluctuation
        if (gameState.mode === 'QUEST_3' && gameState.timeLeft % 8 === 0) {
          gameState.inflow = Math.floor(30 + Math.random() * 50);
          if (sliderInflow) sliderInflow.value = gameState.inflow;
          document.getElementById('cg-val-inflow').textContent = `${gameState.inflow} L/min`;
          addEventLog('INFO', `進水流量動態變動至 ${gameState.inflow} L/min，請即時調節加/減氯！`);
        }

      } else {
        clearInterval(gameState.timerInterval);
        finishQuest();
      }
    }, 1000);
  }

  function evaluateQuestProgress() {
    if (gameState.mode === 'QUEST_1') {
      if (gameState.chlorine >= 0.4 && gameState.chlorine <= 0.8) {
        gameState.questTimeInZone++;
      } else {
        gameState.score = Math.max(50, gameState.score - 1);
      }
    } else if (gameState.mode === 'QUEST_2') {
      if (gameState.chlorine >= 0.3 && gameState.chlorine <= 0.8) {
        gameState.questTimeInZone++;
      } else {
        gameState.score = Math.max(40, gameState.score - 2);
      }
    } else if (gameState.mode === 'QUEST_3') {
      if (gameState.chlorine >= 0.5 && gameState.chlorine <= 0.7) {
        gameState.questTimeInZone++;
      } else {
        gameState.score = Math.max(30, gameState.score - 1);
      }
    }
  }

  function finishQuest() {
    let success = false;
    let msg = '';

    if (gameState.mode === 'QUEST_1') {
      success = (gameState.chlorine >= 0.3 && gameState.chlorine <= 0.9 && gameState.questTimeInZone >= 10);
      msg = success ? '🎉 恭喜通過【暴雨緊急處置關】！成功提升加藥率抵銷有機物需求，守護水質！' : '❌ 關卡失敗！餘氯未及時恢復至安全範圍，致使大腸桿菌風險增加。';
    } else if (gameState.mode === 'QUEST_2') {
      success = (gameState.chlorine >= 0.2 && gameState.chlorine <= 0.9 && gameState.questTimeInZone >= 8);
      msg = success ? '🎉 恭喜通過【加藥過量減氯中和關】！成功投加 NaHSO₃ 中和過量餘氯，消除 THMs 風險！' : '❌ 關卡失敗！過量餘氯未能及時中和降解。';
    } else if (gameState.mode === 'QUEST_3') {
      success = (gameState.questTimeInZone >= 35 && gameState.score >= 70);
      msg = success ? `🏆 卓越成就！通過【60秒動態流量恆定大考驗】，榮獲「輔英水務智慧工程師 100 分認證」！` : '❌ 关卡失敗！動態流量變動下餘氯波動過大。';
    }

    alert(msg);
    addEventLog(success ? 'AUTO_LOGIC' : 'ALARM', msg);
    startQuest('SANDBOX');
  }

  // ============================================================
  // 水務化學物種熱力學解離 (pH Speciation Engine, pKa = 7.53)
  // ============================================================
  const speciationState = {
    source: 'NaOCl', // 'NaOCl' or 'Cl2'
    basePh: 7.2,
    ph: 7.2,
    hclDose: 0.0, // mL/min
    naohDose: 0.0, // mL/min
    totalChlorine: 0.60, // mg/L
    pKa: 7.53,
    hoclPct: 68.1,
    oclPct: 31.9,
    hoclVal: 0.41,
    oclVal: 0.19,
    disinfectionPower: 68.5
  };

  let chartPhSpeciationInstance = null;

  function updatePhFromDosing() {
    const netDose = speciationState.naohDose - speciationState.hclDose;
    const calcPh = speciationState.basePh + (netDose * 0.08);
    const finalPh = Math.max(4.0, Math.min(10.0, parseFloat(calcPh.toFixed(2))));
    
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

    // Germicidal Power relative to 100% HOCl (HOCl is ~80x stronger than OCl-)
    speciationState.disinfectionPower = parseFloat((speciationState.hoclPct + (speciationState.oclPct * 0.0125)).toFixed(1));

    syncSpeciationUI();
    renderPhSpeciationChart();
  }

  function syncSpeciationUI() {
    const phValEl = document.getElementById('speciation-ph-val');
    const doseValEl = document.getElementById('speciation-dose-val');

    if (phValEl) phValEl.textContent = `${speciationState.ph.toFixed(2)} pH`;
    if (doseValEl) doseValEl.textContent = `${speciationState.totalChlorine.toFixed(2)} mg/L`;

    const hclValEl = document.getElementById('spec-val-hcl-dose');
    const naohValEl = document.getElementById('spec-val-naoh-dose');
    const sliderHcl = document.getElementById('slider-spec-hcl');
    const sliderNaoh = document.getElementById('slider-spec-naoh');

    if (hclValEl) hclValEl.textContent = `${speciationState.hclDose.toFixed(1)} mL/min`;
    if (naohValEl) naohValEl.textContent = `${speciationState.naohDose.toFixed(1)} mL/min`;
    if (sliderHcl) sliderHcl.value = speciationState.hclDose;
    if (sliderNaoh) sliderNaoh.value = speciationState.naohDose;

    const hoclValEl = document.getElementById('spec-val-hocl');
    const hoclPctEl = document.getElementById('spec-pct-hocl');
    const oclValEl = document.getElementById('spec-val-ocl');
    const oclPctEl = document.getElementById('spec-pct-ocl');
    const powerValEl = document.getElementById('spec-val-power');

    if (hoclValEl) hoclValEl.innerHTML = `${speciationState.hoclVal.toFixed(2)} <span class="metric-unit">mg/L</span>`;
    if (hoclPctEl) hoclPctEl.textContent = `佔比 ${speciationState.hoclPct}%`;

    if (oclValEl) oclValEl.innerHTML = `${speciationState.oclVal.toFixed(2)} <span class="metric-unit">mg/L</span>`;
    if (oclPctEl) oclPctEl.textContent = `佔比 ${speciationState.oclPct}%`;

    if (powerValEl) powerValEl.innerHTML = `${speciationState.disinfectionPower} <span class="metric-unit">%</span>`;

    const subPower = document.getElementById('spec-sub-power');
    const zoneTag = document.getElementById('speciation-zone-tag');

    if (speciationState.ph >= 6.5 && speciationState.ph <= 7.5) {
      if (subPower) subPower.textContent = '🌟 黃金最佳殺菌消毒區';
      if (zoneTag) {
        zoneTag.className = 'status-badge green';
        zoneTag.textContent = '黃金消毒區 (pH 6.5 ~ 7.5)';
      }
    } else if (speciationState.ph < 6.5) {
      if (subPower) subPower.textContent = '⚡ 微酸超強殺菌區 (留意氣體/設備腐蝕)';
      if (zoneTag) {
        zoneTag.className = 'status-badge cyan';
        zoneTag.textContent = '微酸強效區 (pH < 6.5)';
      }
    } else {
      if (subPower) subPower.textContent = '⚠️ 鹼性消毒低效區 (OCl⁻ 主導，殺菌極慢)';
      if (zoneTag) {
        zoneTag.className = 'status-badge red';
        zoneTag.textContent = '鹼性低效區 (pH > 7.5)';
      }
    }

    const titleEl = document.getElementById('chem-source-title');
    const eqEl = document.getElementById('chem-source-eq');
    const descEl = document.getElementById('chem-source-desc');

    if (speciationState.source === 'NaOCl') {
      if (titleEl) titleEl.textContent = '次氯酸鈉水解化學反應式 (鹼性趨勢)：';
      if (eqEl) eqEl.textContent = 'NaOCl + H₂O ⇌ HOCl + Na⁺ + OH⁻';
      if (descEl) descEl.textContent = 'NaOCl 溶於水釋放 OH⁻ 離子使水體 pH 提升。解離產生的 HOCl 殺菌力為 OCl⁻ 的 80 倍！';
    } else {
      if (titleEl) titleEl.textContent = '氯氣水解化學反應式 (酸性趨勢)：';
      if (eqEl) eqEl.textContent = 'Cl₂(g) + H₂O ⇌ HOCl + H⁺ + Cl⁻';
      if (descEl) descEl.textContent = 'Cl₂ 溶於水產生 H⁺ 離子使水體 pH 下降。若 pH < 4.0 會有氯氣逸散風險，需加鹼調節。';
    }
  }

  function renderPhSpeciationChart() {
    const ctx = document.getElementById('chartPhSpeciation');
    if (!ctx) return;

    const phLabels = [];
    const hoclData = [];
    const oclData = [];
    const currentDotData = [];

    for (let ph = 4.0; ph <= 10.01; ph += 0.2) {
      const phVal = parseFloat(ph.toFixed(1));
      phLabels.push(phVal);

      const r = Math.pow(10, phVal - speciationState.pKa);
      const hFrac = (1 / (1 + r)) * 100;
      const oFrac = (r / (1 + r)) * 100;

      hoclData.push(parseFloat(hFrac.toFixed(1)));
      oclData.push(parseFloat(oFrac.toFixed(1)));

      if (Math.abs(phVal - parseFloat(speciationState.ph.toFixed(1))) < 0.15) {
        currentDotData.push(parseFloat(hFrac.toFixed(1)));
      } else {
        currentDotData.push(null);
      }
    }

    if (chartPhSpeciationInstance) {
      chartPhSpeciationInstance.data.datasets[0].data = hoclData;
      chartPhSpeciationInstance.data.datasets[1].data = oclData;
      chartPhSpeciationInstance.data.datasets[2].data = currentDotData;
      chartPhSpeciationInstance.update('none');
      return;
    }

    chartPhSpeciationInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: phLabels,
        datasets: [
          {
            label: 'HOCl 次氯酸 (%)',
            data: hoclData,
            borderColor: '#00f2fe',
            borderWidth: 2,
            backgroundColor: 'rgba(0, 242, 254, 0.15)',
            fill: true,
            tension: 0.4
          },
          {
            label: 'OCl⁻ 次氯酸根 (%)',
            data: oclData,
            borderColor: '#10b981',
            borderWidth: 2,
            borderDash: [3, 3],
            backgroundColor: 'transparent',
            tension: 0.4
          },
          {
            label: '當前 pH 追蹤游標',
            data: currentDotData,
            borderColor: '#ef4444',
            backgroundColor: '#ef4444',
            pointRadius: 7,
            pointHoverRadius: 9,
            showLine: false
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          x: {
            title: { display: true, text: 'pH 值', color: '#94a3b8', font: { size: 10 } },
            ticks: { color: '#94a3b8', font: { size: 10 } },
            grid: { color: 'rgba(255,255,255,0.05)' }
          },
          y: {
            title: { display: true, text: '物種佔比 (%)', color: '#94a3b8', font: { size: 10 } },
            min: 0,
            max: 100,
            ticks: { color: '#94a3b8', font: { size: 10 } },
            grid: { color: 'rgba(255,255,255,0.05)' }
          }
        }
      }
    });
  }

  // Speciation Sliders & Buttons Event Handlers
  const sliderSpecPh = document.getElementById('slider-speciation-ph');
  if (sliderSpecPh) {
    sliderSpecPh.addEventListener('input', (e) => {
      speciationState.basePh = parseFloat(e.target.value);
      updatePhFromDosing();
    });
  }

  const sliderSpecDose = document.getElementById('slider-speciation-dose');
  if (sliderSpecDose) {
    sliderSpecDose.addEventListener('input', (e) => {
      calcPhSpeciation(speciationState.ph, parseFloat(e.target.value));
    });
  }

  // Acid (HCl) & Alkali (NaOH) Sliders
  const sliderHcl = document.getElementById('slider-spec-hcl');
  if (sliderHcl) {
    sliderHcl.addEventListener('input', (e) => {
      speciationState.hclDose = parseFloat(e.target.value);
      updatePhFromDosing();
    });
  }

  const sliderNaoh = document.getElementById('slider-spec-naoh');
  if (sliderNaoh) {
    sliderNaoh.addEventListener('input', (e) => {
      speciationState.naohDose = parseFloat(e.target.value);
      updatePhFromDosing();
    });
  }

  // Acid / Alkali Quick Buttons
  document.getElementById('btn-hcl-add1')?.addEventListener('click', () => {
    speciationState.hclDose = Math.min(50, speciationState.hclDose + 1.0);
    updatePhFromDosing();
  });

  document.getElementById('btn-hcl-add5')?.addEventListener('click', () => {
    speciationState.hclDose = Math.min(50, speciationState.hclDose + 5.0);
    updatePhFromDosing();
  });

  document.getElementById('btn-hcl-zero')?.addEventListener('click', () => {
    speciationState.hclDose = 0;
    updatePhFromDosing();
  });

  document.getElementById('btn-naoh-add1')?.addEventListener('click', () => {
    speciationState.naohDose = Math.min(50, speciationState.naohDose + 1.0);
    updatePhFromDosing();
  });

  document.getElementById('btn-naoh-add5')?.addEventListener('click', () => {
    speciationState.naohDose = Math.min(50, speciationState.naohDose + 5.0);
    updatePhFromDosing();
  });

  document.getElementById('btn-naoh-zero')?.addEventListener('click', () => {
    speciationState.naohDose = 0;
    updatePhFromDosing();
  });

  document.getElementById('btn-titrate-reset')?.addEventListener('click', () => {
    speciationState.hclDose = 0;
    speciationState.naohDose = 0;
    speciationState.basePh = 7.2;
    updatePhFromDosing();
    addEventLog('INFO', '酸鹼投加量重置，恢復基準水體 pH 7.20。');
  });

  // Reagent Source Buttons
  const btnSourceNaocl = document.getElementById('btn-source-naocl');
  const btnSourceCl2 = document.getElementById('btn-source-cl2');

  btnSourceNaocl?.addEventListener('click', () => {
    speciationState.source = 'NaOCl';
    btnSourceNaocl.classList.add('active');
    btnSourceCl2?.classList.remove('active');
    btnSourceNaocl.style.opacity = '1';
    if (btnSourceCl2) btnSourceCl2.style.opacity = '0.7';

    speciationState.naohDose = Math.min(50, speciationState.naohDose + 3.75);
    updatePhFromDosing();
    addEventLog('INFO', '切換消毒藥劑源為 [次氯酸鈉 NaOCl]：解離產生 OH⁻，促使 pH 微升。');
  });

  btnSourceCl2?.addEventListener('click', () => {
    speciationState.source = 'Cl2';
    btnSourceCl2.classList.add('active');
    btnSourceNaocl?.classList.remove('active');
    btnSourceCl2.style.opacity = '1';
    if (btnSourceNaocl) btnSourceNaocl.style.opacity = '0.7';

    speciationState.hclDose = Math.min(50, speciationState.hclDose + 5.0);
    updatePhFromDosing();
    addEventLog('INFO', '切換消毒藥劑源為 [氯氣 Cl₂]：水解釋放 H⁺，促使 pH 微降。');
  });

  // Titration Quick Action Buttons
  document.getElementById('btn-titrate-hcl')?.addEventListener('click', () => {
    speciationState.hclDose = Math.min(50, speciationState.hclDose + 5.0);
    updatePhFromDosing();
    addEventLog('INFO', `滴定加酸 (+5 mL/min HCl)：pH 降至 ${speciationState.ph.toFixed(2)}，提升 HOCl 強殺菌體比例。`);
  });

  document.getElementById('btn-titrate-naoh')?.addEventListener('click', () => {
    speciationState.naohDose = Math.min(50, speciationState.naohDose + 5.0);
    updatePhFromDosing();
    addEventLog('INFO', `滴定加鹼 (+5 mL/min NaOH)：pH 升至 ${speciationState.ph.toFixed(2)}，OCl⁻ 比例增加。`);
  });

  // pH Challenge Quest Game
  document.getElementById('btn-ph-challenge')?.addEventListener('click', () => {
    speciationState.source = 'NaOCl';
    speciationState.hclDose = 0;
    speciationState.naohDose = 20;
    speciationState.basePh = 7.2;
    updatePhFromDosing();

    alert('🏆 啟動【pH 黃金區間化學配比挑戰】：\n\n情境：加藥源使用次氯酸鈉 (NaOCl)，使得水體加鹼飆升至 pH 8.8 (此時強效 HOCl 僅佔 5%)！\n\n任務目標：請使用「加酸量 (HCl)」滑桿或滴定按鈕，將水體調整至 pH 6.5 ~ 7.2 黃金區間，使 HOCl 佔比達 75% 以上，獲取水務化學特優認證！');

    const checkInterval = setInterval(() => {
      if (speciationState.hoclPct >= 75.0 && speciationState.ph >= 6.5 && speciationState.ph <= 7.2) {
        clearInterval(checkInterval);
        alert(`🎉 恭喜通關！成功將 pH 調節至 ${speciationState.ph.toFixed(2)}，強效殺菌體 [HOCl] 佔比達到 ${speciationState.hoclPct}%！殺菌效能達 100% 黃金水準！`);
        addEventLog('AUTO_LOGIC', '🏆 通過【pH 黃金區間化學配比挑戰】，榮獲輔英水務化學特優勳章！');
      }
    }, 1000);

    setTimeout(() => {
      clearInterval(checkInterval);
    }, 45000);
  });

  // Link button from tab-education "開啟化學解離與 pH 物種分佈實驗室"
  document.getElementById('btn-goto-speciation-lab')?.addEventListener('click', () => {
    switchToTab('tab-speciation-game');
  });

  // Back button from speciation lab to PBL tab
  document.getElementById('btn-back-to-pbl-2')?.addEventListener('click', () => {
    switchToTab('tab-education');
  });

  // Initial calculation
  calcPhSpeciation(7.2, 0.60);

  // Initial UI sync
  syncUI();
});
