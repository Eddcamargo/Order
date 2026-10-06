// producao.js — Controlador Isolado da Linha de Produção (Scanner de Caixas para Workers)

function qs(s) { return document.querySelector(s); }
const scannedBarcodes = new Set();
let cachedOrders = [];

// --- Carregamento de pedidos ---

async function loadProductionOrders() {
  try {
    const res = await fetch('/api/orders/user', { credentials: 'include' });
    if (res.status === 204) return;

    const orders = await res.json();
    cachedOrders = orders; // guarda para consultas de progresso locais

    const select = qs('#production-order-select');
    select.innerHTML = '<option value="">Selecione o pedido ou escaneie a etiqueta</option>';

    orders.forEach(o => {
      if (o.status !== 'finalizado' && o.status !== 'arquivado') {
        const opt = document.createElement('option');
        opt.value = o.id;
        opt.textContent = `#${o.client_order_number || o.id} — ${o.client_name} (${o.description || ''})`;
        select.appendChild(opt);
      }
    });
  } catch (err) {
    console.error('Erro ao buscar ordens de produção:', err);
  }
}

// --- Progress-tracker ---
function displayProgress(order) {
  const section = qs('#production-progress');
  if (!section) return;

  const current = Number(order.current_qty) || 0;
  const total   = Number(order.total_qty)   || 0;
  const pct     = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;

  qs('#progress-order-label').textContent =
    `#${order.client_order_number || order.id} — ${order.client_name}`;

  qs('#progress-bar-fill').style.width = `${pct}%`;
  qs('#progress-percent').textContent  = `${pct}%`;
  qs('#progress-counts').textContent   =
    `${current.toLocaleString('pt-BR')} / ${total.toLocaleString('pt-BR')} un. produzidas`;

  section.classList.remove('hidden');
}

// Busca dados frescos do servidor e atualiza a exibição do progresso.
// Chamado após cada scan bem-sucedido para refletir o novo total imediatamente.
async function refreshAndDisplayProgress(orderId) {
  try {
    const res = await fetch('/api/orders/user', { credentials: 'include' });
    if (res.status === 204) return;

    const orders = await res.json();
    cachedOrders = orders; // mantém cache atualizado

    const order = orders.find(o => String(o.id) === String(orderId));
    if (order) displayProgress(order);
  } catch (err) {
    console.error('Erro ao atualizar progresso:', err);
  }
}

// --- Log de Leituras ---
function addScanLogEntry({ boxNumber, orderLabel, qty }) {
  const list    = qs('#scan-log-list');
  const section = qs('#scan-log-section');
  if (!list || !section) return;

  section.classList.remove('hidden');

  const now = new Date().toLocaleTimeString('pt-BR', {
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });

  // Cria elementos separadamente — evita innerHTML com dados de usuário/scanner
  const entry = document.createElement('div');
  entry.className = 'scan-log-entry scan-log-entry--new';

  const boxTag = document.createElement('span');
  boxTag.className = 'box-tag';
  boxTag.textContent = `CX${boxNumber}`;

  const label = document.createElement('span');
  label.className = 'scan-log-label';
  label.textContent = `Pedido ${orderLabel}`;

  const qtyEl = document.createElement('span');
  qtyEl.className = 'scan-log-qty';
  qtyEl.textContent = `+${Number(qty).toLocaleString('pt-BR')} un.`;

  const timeEl = document.createElement('span');
  timeEl.className = 'scan-log-time';
  timeEl.textContent = now;

  entry.append(boxTag, label, qtyEl, timeEl);

  // Insere no topo (mais recente primeiro)
  list.insertBefore(entry, list.firstChild);

  // Remove classe de destaque após 1s para não sobrecarregar o DOM com transições
  setTimeout(() => entry.classList.remove('scan-log-entry--new'), 1000);

  // Limita a 10 entradas — remove as mais antigas do final
  while (list.children.length > 10) {
    list.removeChild(list.lastChild);
  }
}

// --- Processamento do scan ---

async function processWorkerScan() {
  const inputEl = qs('#production-scan-input');
  const rawValue = inputEl.value.trim();
  let selectedOrderId = qs('#production-order-select').value;

  if (!rawValue) return;

  const feedbackEl = qs('#production-feedback');
  let quantityToIncrement = 0;
  let parsedBoxNumber = '?'; // número da caixa extraído do código de barras

  // --- Interprete do codigo de barras ---
  if (rawValue.startsWith('CLT')) {
    const patternMatch = rawValue.match(/CLT(\d+)-ORD(\d+)-CX(\d+)-QTY(\d+)/);
    if (patternMatch) {
      // Verifica duplicata ANTES de processar — previne dupla contagem se o operador
      // bipar a mesma caixa duas vezes sem perceber
      if (scannedBarcodes.has(rawValue)) {
        feedbackEl.className = 'feedback-error';
        feedbackEl.textContent = `⚠️ ATENÇÃO: Esta caixa (${rawValue}) já foi registrada nesta sessão! Verifique se a etiqueta foi bipada duas vezes.`;
        inputEl.value = '';
        return;
      }

      selectedOrderId   = patternMatch[2];        // Grupo 2 = orderId
      parsedBoxNumber   = patternMatch[3];         // Grupo 3 = número da caixa (para o log)
      quantityToIncrement = parseInt(patternMatch[4], 10); // Grupo 4 = QTY

      // Sincroniza visualmente o select com o pedido do código bipado
      qs('#production-order-select').value = selectedOrderId;
    } else {
      feedbackEl.className = 'feedback-error';
      feedbackEl.textContent = 'Erro: Padrão de código de barras corrompido. Esperado: CLT[x]-ORD[x]-CX[x]-QTY[x]';
      inputEl.value = '';
      return;
    }
  } else {
    // Fallback: quantidade digitada manualmente com pedido já selecionado no dropdown
    if (!selectedOrderId) {
      feedbackEl.className = 'feedback-error';
      feedbackEl.textContent = 'Selecione o pedido acima antes de digitar a quantidade manual.';
      inputEl.value = '';
      return;
    }
    quantityToIncrement = parseInt(rawValue, 10);
  }

  if (isNaN(quantityToIncrement) || quantityToIncrement <= 0) {
    feedbackEl.className = 'feedback-error';
    feedbackEl.textContent = 'Quantidade inválida para processamento.';
    inputEl.value = '';
    return;
  }

  try {
    // Dispara incremento para a API de produção do servidor
    const res = await fetch(`/api/orders/${selectedOrderId}/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include', // necessário para sessão autenticada
      body: JSON.stringify({ qty_added: quantityToIncrement })
    });

    const result = await res.json();

    if (result.error) {
      feedbackEl.className = 'feedback-error';
      feedbackEl.textContent = `Erro do servidor: ${result.error}`;
    } else {
      // SUCESSO: atualiza feedback, log e progresso 
      feedbackEl.className = 'feedback-success';
      feedbackEl.textContent = `✓ Pedido #${selectedOrderId}: +${quantityToIncrement} un. registradas.`;

      // Marca o código como lido nesta sessão — impede re-scan acidental
      if (rawValue.startsWith('CLT')) {
        scannedBarcodes.add(rawValue);
      }

      // Monta o label legível do pedido para exibição no log
      const cachedOrder = cachedOrders.find(o => String(o.id) === String(selectedOrderId));
      const orderLabel = cachedOrder
        ? `#${cachedOrder.client_order_number || cachedOrder.id} (${cachedOrder.client_name})`
        : `#${selectedOrderId}`;

      // Adiciona entrada no log de leituras da sessão
      addScanLogEntry({
        boxNumber: parsedBoxNumber,
        orderLabel,
        qty: quantityToIncrement
      });

      // Busca dados atualizados e re-renderiza a barra de progresso
      await refreshAndDisplayProgress(selectedOrderId);

      inputEl.value = '';
      inputEl.focus(); // mantém foco ativo para o próximo bipe
    }
  } catch (err) {
    console.error(err);
    feedbackEl.className = 'feedback-error';
    feedbackEl.textContent = 'Falha de conexão com o servidor.';
  }
}

// --- Inicialização ---

document.addEventListener('DOMContentLoaded', () => {
  loadProductionOrders();
  qs('#production-scan-input').focus();

  // Escuta confirmação por clique
  qs('#btn-submit-production-scan').addEventListener('click', processWorkerScan);

  // Escuta Enter enviado pelo terminador de linha do leitor USB
  qs('#production-scan-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      processWorkerScan();
    }
  });

  // Ao trocar de pedido manualmente no dropdown, exibe o progresso atual
  // usando os dados já cacheados — sem fetch extra
  qs('#production-order-select').addEventListener('change', (e) => {
    const orderId = e.target.value;
    if (!orderId) {
      qs('#production-progress').classList.add('hidden');
      return;
    }
    const order = cachedOrders.find(o => String(o.id) === String(orderId));
    if (order) displayProgress(order);
  });
});