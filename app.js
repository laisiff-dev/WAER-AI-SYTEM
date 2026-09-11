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

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      panels.forEach(p => p.classList.remove('active'));

      tab.classList.add('active');
      const targetPanel = document.getElementById(tab.dataset.tab);
      if (targetPanel) {
        targetPanel.classList.add('active');
      }

      // Re-render charts when entering charts tabs
      if (tab.dataset.tab === 'tab-reports') {
        renderLongTermChart();
      } else if (tab.dataset.tab === 'tab-education') {
        renderRegressionChart();
      }
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
    const valInput = document.getElementById('input-dpd-val');
    const val = parseFloat(valInput.value);
    if (!isNaN(val) && val > 0) {
      state.dpdLabData.push({ chlorine: val, orp: Math.round(state.cleanWaterOrp) });
      renderRegressionChart();
      alert(`已成功新增 DPD 採樣點 (${val} mg/L, ORP ${Math.round(state.cleanWaterOrp)}mV)！`);
      valInput.value = '';
    }
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

  // Initial UI sync
  syncUI();
});
