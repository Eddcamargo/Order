// expedicao.js — Controlador de Expedição com Agrupamento por Pedido + Log de Sessão
function qs(s) { return document.querySelector(s); }

/**
 * Estrutura de dados principal.
 * Cada chave é um order_id; o valor agrupa todas as caixas daquele pedido.
 * {
 *   order_id, client_name, client_order_number,
 *   product_code, product_description,
 *   total_boxes, order_complete,
 *   boxes: [{ barcode, product_qty, scanned_at }],
 *   first_scan, last_scan_ts
 * }
 *
 * Log de sessão (separado):
 * sessionLog = [ { barcode, order_id, scanned_at, ts } ] — ordem cronológica
 */
let orderGroups = {};
let sessionLog = []; // NOVO: log cronológico de todas as caixas lidas

// --- Feedback ---
function showFeedback(message, isError = false) {
  const el = qs('#shipping-feedback');
  if (!el) return;
  el.textContent = message;
  el.className = 'feedback-box ' + (isError ? 'feedback-error' : 'feedback-success');
  setTimeout(() => { el.className = 'feedback-box'; el.textContent = ''; }, 6000);
}

// --- Renderização de sub-componentes --- 
function renderBoxTags(boxes) {
  if (!boxes.length) return '—';
  return boxes.map(b =>
    `<span class="box-tag" title="Lida às ${b.scanned_at}">${b.barcode}</span>`
  ).join('');
}

function renderProgress(dispatched, total, isComplete) {
  if (!total) {
    return `<div class="progress-wrapper">
      <span class="progress-text" style="color:#0284c7;">${dispatched} cx lida${dispatched !== 1 ? 's' : ''}</span>
    </div>`;
  }
  const pct = Math.min(100, Math.round((dispatched / total) * 100));
  const color = isComplete ? '#16a34a' : '#0284c7';
  return `<div class="progress-wrapper">
    <div class="progress-bar-track">
      <div class="progress-bar-fill" style="width:${pct}%; background:${color};"></div>
    </div>
    <span class="progress-text" style="color:${color};">${dispatched}/${total}</span>
  </div>`;
}

function renderActionCell(order) {
  if (order.order_complete) {
    return `<div class="gear-wrapper">
      <button class="btn-gear" data-order-id="${order.order_id}">⚙️</button>
      <div class="gear-menu hidden" id="menu-${order.order_id}">
        <button class="btn-pdf" data-order-id="${order.order_id}">📄 Ver/Gerar PDF</button>
        <button class="btn-archive" data-order-id="${order.order_id}">🗄️ Arquivar Pedido</button>
      </div>
    </div>`;
  }
  return `<div style="display:flex; flex-direction:column; gap:4px; align-items:center;">
    <span style="font-size:0.72rem; color:var(--text-muted);">Aguardando caixas...</span>
    <button class="btn-finalize-manual" data-order-id="${order.order_id}" 
            title="Clique para marcar como completo manualmente">✅ Finalizar</button>
  </div>`;
}

// --- NOVO: Render do Log de Sessão ---
function renderSessionLog() {
  const listEl = qs('#scan-log-list');
  const countEl = qs('#session-count');
  if (!listEl) return;

  if (countEl) {
    countEl.textContent = `${sessionLog.length} caixa${sessionLog.length !== 1 ? 's' : ''}`;
  }

  if (sessionLog.length === 0) {
    listEl.innerHTML = `<div class="scan-log-empty">Nenhuma caixa escaneada ainda nesta sessão.</div>`;
    return;
  }

  // Mostra do mais recente para o mais antigo
  const reversed = [...sessionLog].reverse();
  listEl.innerHTML = reversed.map((entry, idx) => `
    <div class="scan-log-entry ${idx === 0 ? 'scan-log-entry--new' : ''}">
      <span class="scan-log-barcode" title="${entry.barcode}">${entry.barcode}</span>
      <span class="scan-log-time">${entry.scanned_at}</span>
    </div>
  `).join('');
}

// --- Render principal da tabela ---
function renderSessionHistory() {
  const tbody = qs('#shipping-history-tbody');
  const orders = Object.values(orderGroups);

  if (orders.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="no-data">Nenhuma caixa expedida nesta sessão.</td></tr>`;
    return;
  }

  const sorted = [...orders].sort((a, b) => b.last_scan_ts - a.last_scan_ts);
  tbody.innerHTML = sorted.map(order => {
    const isComplete = order.order_complete;
    const statusBadge = isComplete
      ? `<span class="badge-complete">✅ Completo</span>`
      : `<span class="badge-pending">⏳ Pendente</span>`;
    return `
      <tr class="${isComplete ? 'row-complete' : 'row-pending'}">
        <td><strong>#${order.client_order_number || order.order_id}</strong></td>
        <td>${order.client_name || 'Não Informado'}</td>
        <td style="font-size:0.85rem;">${order.product_code} - ${order.product_description}</td>
        <td class="text-center boxes-cell">${renderBoxTags(order.boxes)}</td>
        <td class="text-center" style="min-width:130px;">
          ${renderProgress(order.boxes.length, order.total_boxes, isComplete)}
          ${statusBadge}
        </td>
        <td style="font-size:0.85rem; white-space:nowrap;">${order.first_scan}</td>
        <td class="text-center" style="min-width:110px;">${renderActionCell(order)}</td>
      </tr>
    `;
  }).join('');

  attachTableListeners();
}

// --- Listeners da tabela ---
function attachTableListeners() {
  const tbody = qs('#shipping-history-tbody');

  tbody.querySelectorAll('.btn-gear').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('.gear-menu').forEach(m => m.classList.add('hidden'));
      const id = btn.getAttribute('data-order-id');
      qs(`#menu-${id}`).classList.remove('hidden');
    });
  });

  tbody.querySelectorAll('.btn-pdf').forEach(btn => {
    btn.addEventListener('click', async () => {
      const orderId = btn.getAttribute('data-order-id');
      try {
        const res = await fetch(`/api/orders/${orderId}/generate-pdf`, {
          method: 'POST', credentials: 'include'
        });
        const data = await res.json();
        if (data.pdf_path) {
          window.open(data.pdf_path, '_blank');
        } else {
          alert('Erro ao gerar PDF: ' + (data.error || 'Desconhecido'));
        }
      } catch {
        alert('Falha na comunicação com o servidor.');
      }
    });
  });

  tbody.querySelectorAll('.btn-archive').forEach(btn => {
    btn.addEventListener('click', async () => {
      const orderId = btn.getAttribute('data-order-id');
      if (!confirm('Deseja mover este pedido para o arquivo morto e retirá-lo da lista ativa?')) return;
      try {
        const res = await fetch(`/api/orders/${orderId}/archive`, {
          method: 'POST', credentials: 'include'
        });
        const data = await res.json();
        if (data.success) {
          showFeedback('Pedido arquivado com sucesso!');
          delete orderGroups[orderId];
          renderSessionHistory();
        } else {
          alert('Erro: ' + data.error);
        }
      } catch {
        alert('Erro ao tentar arquivar o pedido.');
      }
    });
  });

  tbody.querySelectorAll('.btn-finalize-manual').forEach(btn => {
    btn.addEventListener('click', () => {
      const orderId = btn.getAttribute('data-order-id');
      const order = orderGroups[orderId];
      if (!order) return;
      if (order.boxes.length === 0) {
        showFeedback('Nenhuma caixa foi escaneada para este pedido.', true);
        return;
      }
      if (!confirm(`Finalizar pedido #${order.client_order_number || orderId} com ${order.boxes.length} caixa(s) lida(s)? Esta ação libera o PDF e o arquivamento.`)) return;
      orderGroups[orderId].order_complete = true;
      showFeedback(`Pedido #${order.client_order_number || orderId} marcado como completo!`);
      renderSessionHistory();
    });
  });
}

// --- Processamento de scan ---
async function processShippingScan() {
  const inputEl = qs('#shipping-scan-input');
  const barcodeValue = inputEl.value.trim();
  if (!barcodeValue) return;

  try {
    const res = await fetch('/api/shipping/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ barcode: barcodeValue })
    });
    const result = await res.json();

    if (!res.ok || result.error) {
      showFeedback(`Erro: ${result.error || 'Falha ao processar expedição.'}`, true);
      return;
    }

    const now = new Date();
    const timeStr = now.toLocaleTimeString('pt-BR', {
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    const orderId = result.order_id;

    //Cria o grupo do pedido se for a 1ª caixa
    if (!orderGroups[orderId]) {
      orderGroups[orderId] = {
        order_id: orderId,
        client_name: result.client_name,
        client_order_number: result.client_order_number,
        product_code: result.product_code,
        product_description: result.product_description,
        total_boxes: result.total_boxes || null,
        order_complete: false,
        boxes: [],
        first_scan: timeStr,
        last_scan_ts: now.getTime()
      };
    }

    const group = orderGroups[orderId];

    // Verifica duplicata
    const alreadyScanned = group.boxes.some(b => b.barcode === barcodeValue);
    if (alreadyScanned) {
      showFeedback(`⚠️ Caixa ${barcodeValue} já foi escaneada nesta sessão!`, true);
      return;
    }

    // Adiciona caixa ao grupo 
    group.boxes.push({
      barcode: barcodeValue,
      product_qty: result.product_qty,
      scanned_at: timeStr
    });
    group.last_scan_ts = now.getTime();

    // Adiciona ao log de sessão 
    sessionLog.push({
      barcode: barcodeValue,
      order_id: orderId,
      scanned_at: timeStr,
      ts: now.getTime()
    });

    if (result.total_boxes) group.total_boxes = result.total_boxes;

    // Verifica se o pedido está completo
    if (group.total_boxes && group.boxes.length >= group.total_boxes) {
      group.order_complete = true;
    }

    // --- Feedback ---
    if (group.order_complete) {
      showFeedback(`✅ Pedido #${result.client_order_number || orderId} completo! Todas as caixas foram escaneadas. Você já pode gerar o PDF.`);
    } else if (group.total_boxes) {
      const restantes = group.total_boxes - group.boxes.length;
      showFeedback(`📦 Caixa ${barcodeValue} registrada. Falta${restantes !== 1 ? 'm' : ''} ${restantes} caixa${restantes !== 1 ? 's' : ''} para concluir o pedido #${result.client_order_number || orderId}.`);
    } else {
      showFeedback(`📦 Caixa ${barcodeValue} registrada no pedido #${result.client_order_number || orderId}. (${group.boxes.length} cx lidas até agora)`);
    }

    renderSessionHistory();
    renderSessionLog(); // atualiza o log visual

  } catch (err) {
    console.error(err);
    showFeedback('Falha de rede ao conectar com o servidor.', true);
  } finally {
    inputEl.value = '';
    inputEl.focus();
  }
}

// --- Inicialização --- 
document.addEventListener('click', (e) => {
  if (!e.target.closest('.gear-wrapper')) {
    document.querySelectorAll('.gear-menu').forEach(m => m.classList.add('hidden'));
  }
});

document.addEventListener('DOMContentLoaded', () => {
  const inputEl = qs('#shipping-scan-input');
  if (inputEl) inputEl.focus();

  qs('#btn-submit-shipping-scan').addEventListener('click', processShippingScan);
  if (inputEl) {
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        processShippingScan();
      }
    });
  }
});