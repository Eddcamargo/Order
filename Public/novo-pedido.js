// tela para criar os pedidos
function qs(s) { return document.querySelector(s); }
const container = qs('#boxes-container');

let boxCount = 0;
let cachedProducts = [];
let cachedClients = [];    
let editOrderId = null;

// --- Utilitarios de modal/abas --- 
function switchTab(entity, mode) {
  if (mode === 'add') {
    qs(`#${entity}-pane-add`).style.display = 'block';
    qs(`#${entity}-pane-del`).style.display = 'none';
  } else {
    qs(`#${entity}-pane-add`).style.display = 'none';
    qs(`#${entity}-pane-del`).style.display = 'block';
  }
}

function openModal(id) { qs(`#${id}`).style.display = 'flex'; }
function closeModal(id) { qs(`#${id}`).style.display = 'none'; }

// --- Padronização de data (input type="date" → ISO yyyy-mm-dd) ---
function setDefaultDates() {
  const today = new Date();
  const format = (d) => d.toISOString().split('T')[0];

  const startInput = qs('#order-start-date');
  const dueInput   = qs('#order-due-date');

  if (startInput && !startInput.value) startInput.value = format(today);
  if (dueInput && !dueInput.value) {
    const nextWeek = new Date();
    nextWeek.setDate(today.getDate() + 7);
    dueInput.value = format(nextWeek);
  }
}

// Converte yyyy-mm-dd ou dd/mm/yyyy (banco) → yyyy-mm-dd (input date)
function apiToDateInput(value) {
  if (!value) return '';
  if (value.includes('/')) {
    const [d, m, y] = value.split('/');
    return `${y}-${m}-${d}`;
  }
  return value;
}

// --- Toggle de tema claro/escuro ---                
function initThemeToggle() {
  const toggle = document.getElementById('theme-toggle');
  if (!toggle) return;

  const savedTheme = localStorage.getItem('theme') || 'dark';
  if (savedTheme === 'light') {
    document.body.classList.add('light-mode');
    toggle.checked = true;
  }

  toggle.addEventListener('change', () => {
    if (toggle.checked) {
      document.body.classList.add('light-mode');
      localStorage.setItem('theme', 'light');
    } else {
      document.body.classList.remove('light-mode');
      localStorage.setItem('theme', 'dark');
    }
  });
}

// --- Fetch seguro --- 
async function safeFetchJson(url, options = {}) {
  try {
    const res = await fetch(url, options);

    if (!res.ok) {
      throw new Error(`O servidor respondeu com código de erro HTTP ${res.status} (${res.statusText})`);
    }

    const contentType = res.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      const textoBruto = await res.text();
      console.error(`🚨 ERRO CRÍTICO NA ROTA [${url}]: O servidor não devolveu um JSON válido.`);
      console.error('Texto bruto recebido do servidor:', textoBruto);
      if (textoBruto.includes('<!DOCTYPE html>') || textoBruto.includes('<html')) {
        throw new Error(
          `A rota '${url}' retornou uma página HTML em vez de dados JSON.\n\n` +
          `Motivos prováveis:\n` +
          `1. A rota não existe no backend (server.js).\n` +
          `2. O servidor travou/reiniciou.\n` +
          `3. O sistema de login bloqueou a requisição.`
        );
      }
      throw new Error(`O servidor retornou um texto inesperado: "${textoBruto.substring(0, 100)}..."`);
    }

    return await res.json();
  } catch (err) {
    console.error(`Falha ao obter dados da URL: ${url}`, err);
    throw err;
  }
}

// --- Autocomplete generico ---

function setupAutocomplete({ inputId, hiddenId, dropdownId, getItems, displayText, subText, onSelect }) {
  const input    = qs(`#${inputId}`);
  const hidden   = qs(`#${hiddenId}`);
  const dropdown = qs(`#${dropdownId}`);
  if (!input || !dropdown) return;

  let activeIndex = -1;

  const render = (query) => {
    const items    = getItems();
    const q        = query.toLowerCase().trim();
    const filtered = q ? items.filter(i => displayText(i).toLowerCase().includes(q)) : items;

    dropdown.innerHTML = '';
    activeIndex = -1;

    if (filtered.length === 0) { dropdown.style.display = 'none'; return; }

    filtered.slice(0, 12).forEach((item) => {
      const div = document.createElement('div');
      div.className  = 'autocomplete-item';
      div.dataset.id = item.id;

      const main = document.createElement('span');
      main.textContent = displayText(item);
      div.appendChild(main);

      if (subText) {
        const sub = document.createElement('span');
        sub.className   = 'item-sub';
        sub.textContent = subText(item);
        div.appendChild(sub);
      }

      div.addEventListener('mousedown', (e) => { e.preventDefault(); selectItem(item); });
      dropdown.appendChild(div);
    });

    dropdown.style.display = filtered.length ? 'block' : 'none';
  };

  const selectItem = (item) => {
    input.value = displayText(item);
    if (hidden) hidden.value = item.id;
    dropdown.style.display = 'none';
    if (onSelect) onSelect(item);
  };

  const setActive = (idx) => {
    const items = dropdown.querySelectorAll('.autocomplete-item');
    items.forEach(i => i.classList.remove('active'));
    if (idx >= 0 && idx < items.length) {
      items[idx].classList.add('active');
      items[idx].scrollIntoView({ block: 'nearest' });
    }
    activeIndex = idx;
  };

  input.addEventListener('focus', () => render(input.value));
  input.addEventListener('input', () => { if (hidden) hidden.value = ''; render(input.value); });

  input.addEventListener('keydown', (e) => {
    const visible = dropdown.style.display === 'block';
    const items   = dropdown.querySelectorAll('.autocomplete-item');
    if (!visible) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault(); setActive(Math.min(activeIndex + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault(); setActive(Math.max(activeIndex - 1, 0));
    } else if (e.key === 'Tab' || e.key === 'Enter') {
      if (activeIndex >= 0 && items[activeIndex]) {
        e.preventDefault(); items[activeIndex].dispatchEvent(new Event('mousedown'));
      } else if (e.key === 'Tab' && items[0]) {
        items[0].dispatchEvent(new Event('mousedown'));
      }
    } else if (e.key === 'Escape') {
      dropdown.style.display = 'none';
    }
  });

  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.style.display = 'none';
    }
  });
}

// --- Autocomplete do Cliente Principal ---
function initClientAutocomplete(currentVal = '') {
  const input  = qs('#order-client-input');
  const hidden = qs('#order-client');
  if (!input) return;

  setupAutocomplete({
    inputId:     'order-client-input',
    hiddenId:    'order-client',
    dropdownId:  'order-client-dropdown',
    getItems:    () => cachedClients,
    displayText: (c) => c.name,
    onSelect:    (c) => { if (hidden) hidden.value = c.id; }
  });

  // Preenche automaticamente se já houver valor (modo edição)
  if (currentVal) {
    const match = cachedClients.find(c => String(c.id) === String(currentVal));
    if (match) {
      input.value = match.name;
      if (hidden) hidden.value = match.id;
    }
  }
}

// --- Autocomplete de Produto dentro de cada Caixa ---
function initBoxProductAutocomplete(input, hidden, currentValue = '') {
  if (!input) return;

  // Cria o dropdown dinamicamente se ainda não existir nesta caixa
  let dropdown = input.parentElement.querySelector('.autocomplete-dropdown');
  if (!dropdown) {
    dropdown = document.createElement('div');
    dropdown.className = 'autocomplete-dropdown';
    input.parentElement.style.position = 'relative';
    input.parentElement.appendChild(dropdown);
  }

  let activeIndex = -1;

  const render = (query) => {
    const q = query.toLowerCase().trim();
    const filtered = q
      ? cachedProducts.filter(p => `${p.code} ${p.description}`.toLowerCase().includes(q))
      : cachedProducts;

    dropdown.innerHTML = '';
    activeIndex = -1;

    if (filtered.length === 0) { dropdown.style.display = 'none'; return; }

    filtered.slice(0, 10).forEach((p) => {
      const div = document.createElement('div');
      div.className  = 'autocomplete-item';
      div.dataset.id = p.id;

      const main = document.createElement('span');
      main.textContent = `${p.code} - ${p.description}`;
      div.appendChild(main);

      const sub = document.createElement('span');
      sub.className   = 'item-sub';
      sub.textContent = `${p.weight_grams || 0}g`;
      div.appendChild(sub);

      div.addEventListener('mousedown', (e) => {
        e.preventDefault();
        input.value          = `${p.code} - ${p.description}`;
        hidden.value         = p.id;
        input.dataset.weight = p.weight_grams || 0;
        dropdown.style.display = 'none';
        updateBalances();
      });
      dropdown.appendChild(div);
    });

    dropdown.style.display = filtered.length ? 'block' : 'none';
  };

  input.addEventListener('focus', () => render(input.value));
  input.addEventListener('input', () => {
    hidden.value         = '';
    input.dataset.weight = '';
    render(input.value);
  });

  input.addEventListener('keydown', (e) => {
    const visible = dropdown.style.display === 'block';
    const items   = dropdown.querySelectorAll('.autocomplete-item');
    if (!visible) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, items.length - 1);
      items.forEach(i => i.classList.remove('active'));
      items[activeIndex]?.classList.add('active');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      items.forEach(i => i.classList.remove('active'));
      items[activeIndex]?.classList.add('active');
    } else if (e.key === 'Tab' || e.key === 'Enter') {
      if (activeIndex >= 0 && items[activeIndex]) {
        e.preventDefault(); items[activeIndex].dispatchEvent(new Event('mousedown'));
      } else if (e.key === 'Tab' && items[0]) {
        items[0].dispatchEvent(new Event('mousedown'));
      }
    } else if (e.key === 'Escape') {
      dropdown.style.display = 'none';
    }
  });

  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.style.display = 'none';
    }
  });

  // Preenche valor atual (modo edição)
  if (currentValue) {
    const match = cachedProducts.find(p => String(p.id) === String(currentValue));
    if (match) {
      input.value          = `${match.code} - ${match.description}`;
      hidden.value         = match.id;
      input.dataset.weight = match.weight_grams || 0;
    }
  }
}

// --- Modal de cadastro de produto ---
function openProductModalForAdd() {
  const addRadio = document.querySelector('input[name="product-action"][value="add"]');
  if (addRadio) {
    addRadio.checked = true;
    switchTab('product', 'add');
  }
  openModal('modal-product');
  setTimeout(() => {
    const codeInput = document.getElementById('new-prod-code');
    if (codeInput) codeInput.focus();
  }, 100);
}

// --- Carregamento de dados ---
async function loadClients() {
  try {
    cachedClients = await safeFetchJson('/api/clients', { credentials: 'include' });

    // Popula apenas o select de exclusão (o campo de seleção usa autocomplete)
    const deleteSelect = qs('#delete-client-select');
    if (deleteSelect) {
      deleteSelect.innerHTML = '<option value="">Selecione o cliente para apagar...</option>';
      cachedClients.forEach(c => {
        const opt = document.createElement('option');
        opt.value       = c.id;
        opt.textContent = c.name;
        deleteSelect.appendChild(opt);
      });
    }

    // (Re-)inicializa o autocomplete do campo de cliente
    initClientAutocomplete(qs('#order-client')?.value || '');
  } catch (err) {
    if (err.message.includes('401')) { window.location.href = '/Public/order.html'; return; }
    console.error('Erro ao buscar clientes:', err);
  }
}

async function loadProducts() {
  try {
    cachedProducts = await safeFetchJson('/api/products', { credentials: 'include' });

    // Popula o select de exclusão de produtos
    const deleteProdSelect = qs('#delete-product-select');
    if (deleteProdSelect) {
      deleteProdSelect.innerHTML = '<option value="">Selecione para apagar...</option>';
      cachedProducts.forEach(p => {
        const opt = document.createElement('option');
        opt.value       = p.id;
        opt.textContent = `${p.code} - ${p.description}`;
        deleteProdSelect.appendChild(opt);
      });
    }

    // Re-inicializa o autocomplete de produto em cada caixa já renderizada
    if (container) {
      container.querySelectorAll('.box-row').forEach(row => {
        const input  = row.querySelector('.box-product-input');
        const hidden = row.querySelector('.box-product-hidden');
        if (input) initBoxProductAutocomplete(input, hidden, hidden?.value || '');
      });
    }
    updateBalances();
  } catch (err) {
    console.error('Erro ao buscar produtos:', err);
  }
}

// --- Criação de caixas ---
function createBoxRow(qtyValue = 0, selectedProductId = '') {
  if (!container) return;
  boxCount++;
  const num = boxCount;

  const div = document.createElement('div');
  div.className = 'box-row';
  div.id        = `box-row-${num}`;
  div.setAttribute('data-box-num', num);

  div.innerHTML = `
    <div class="box-number-badge">Cx ${num}</div>
    <div class="box-product-wrapper">
      <input type="text" class="form-control box-product-input"
             placeholder="Digite o código ou nome..." autocomplete="off">
      <input type="hidden" class="box-product-hidden" value="">
      <button type="button" class="btn-add-product-inline"
              onclick="openProductModalForAdd()" title="Cadastrar novo produto">⚙️</button>
    </div>
    <input type="number" class="form-control box-qty" value="${qtyValue}" min="0" placeholder="Qtd">
    ${num > 1
      ? `<button type="button" class="btn-remove-box" title="Remover caixa">❌</button>`
      : `<span></span>`}
  `;

  container.appendChild(div);

  const input  = div.querySelector('.box-product-input');
  const hidden = div.querySelector('.box-product-hidden');
  initBoxProductAutocomplete(input, hidden, selectedProductId);

  div.querySelector('.box-qty').addEventListener('input', updateBalances);

  if (num > 1) {
    div.querySelector('.btn-remove-box').addEventListener('click', () => {
      div.remove();
      renumberBoxes();
      updateBalances();
    });
  }
}

function renumberBoxes() {
  if (!container) return;
  const rows = container.querySelectorAll('.box-row');
  boxCount = 0;
  rows.forEach((row) => {
    boxCount++;
    row.id = `box-row-${boxCount}`;
    row.setAttribute('data-box-num', boxCount);
    row.querySelector('.box-number-badge').textContent = `Cx ${boxCount}`;
  });
}

// --- Cálculos de saldo ---
function updateBalances() {
  const totalOrderInput = qs('#order-total-qty');
  if (!totalOrderInput) return;

  const totalOrder = parseInt(totalOrderInput.value) || 0;
  const statTotal  = qs('#stat-total');
  if (statTotal) statTotal.textContent = totalOrder.toLocaleString('pt-BR');

  let totalAllocated  = 0;
  let totalWeightGrams = 0;

  if (container) {
    container.querySelectorAll('.box-row').forEach(row => {
      const qty    = parseInt(row.querySelector('.box-qty').value) || 0;
      const input  = row.querySelector('.box-product-input');
      const weight = parseFloat(input?.dataset.weight) || 0;   // ← dataset.weight via autocomplete
      totalAllocated   += qty;
      totalWeightGrams += qty * weight;
    });
  }

  const remaining    = totalOrder - totalAllocated;
  const totalWeightKg = totalWeightGrams / 1000;

  const statAllocated = qs('#stat-allocated');
  const statRemaining = qs('#stat-remaining');
  const statWeight    = qs('#stat-weight');

  if (statAllocated) statAllocated.textContent = totalAllocated.toLocaleString('pt-BR');

  if (statRemaining) {
    statRemaining.textContent = remaining.toLocaleString('pt-BR');
    statRemaining.className   = remaining === 0 ? 'status-ok' : 'status-warn';
  }

  if (statWeight) {
    statWeight.textContent = `${totalWeightKg.toLocaleString('pt-BR', {
      minimumFractionDigits: 2, maximumFractionDigits: 2
    })} kg`;
  }
}

function suggestDivision() {
  const totalOrder = parseInt(qs('#order-total-qty').value) || 0;
  const capacity   = parseInt(qs('#suggest-cap')?.value)   || 1000;

  if (totalOrder <= 0 || capacity <= 0) return alert('Insira valores válidos para simular!');

  // Preserva o produto já selecionado na primeira caixa
  const firstHidden   = container?.querySelector('.box-product-hidden');
  const selectedProdId = firstHidden?.value || '';

  if (container) container.innerHTML = '';
  boxCount = 0;

  let remaining = totalOrder;
  while (remaining > 0) {
    const qty = Math.min(capacity, remaining);
    createBoxRow(qty, selectedProdId);
    remaining -= qty;
  }
  updateBalances();
}

// --- Modo de edição ---
async function setupEditMode(id) {
  editOrderId = id;
  const title = qs('h1');
  if (title) title.textContent = `✏️ Editar Planejamento do Pedido #${id}`;

  try {
    const order = await safeFetchJson(`/api/orders/${id}`, { credentials: 'include' });

    // Preenche o campo de cliente via autocomplete
    const clientInput  = qs('#order-client-input');
    const clientHidden = qs('#order-client');
    if (order.client_id) {
      const match = cachedClients.find(c => String(c.id) === String(order.client_id));
      if (clientInput)  clientInput.value    = match ? match.name : '';
      if (clientHidden) clientHidden.value   = order.client_id;
      if (clientInput)  clientInput.disabled = true; // impede troca acidental de cliente
    }

    qs('#order-description').value  = order.description || '';
    qs('#order-total-qty').value    = order.total_qty   || 0;
    qs('#order-start-date').value   = apiToDateInput(order.start_date);
    qs('#order-due-date').value     = apiToDateInput(order.due_date);

    if (container) container.innerHTML = '';
    boxCount = 0;

    if (order.boxes && order.boxes.length > 0) {
      order.boxes.forEach(box => createBoxRow(box.product_qty, box.product_id));
    } else {
      createBoxRow(0);
    }
    updateBalances();
  } catch (err) {
    console.error('Erro ao montar ambiente de edição:', err);
  }
}

// --- Modal de sucesso ---
function showOrderSuccessModal(orderId, onGenerateLabels, onGoToDashboard) {
  const overlay   = qs('#modal-order-success');
  const labelEl   = qs('#success-order-id-label');
  const btnLabels = qs('#btn-success-labels');
  const btnDash   = qs('#btn-success-dashboard');
  if (!overlay) return;

  if (labelEl) labelEl.textContent = `Pedido #${orderId}`;

  // Reinicia a animação do checkmark
  const circle = overlay.querySelector('.checkmark-circle');
  if (circle) { circle.style.animation = 'none'; void circle.offsetWidth; circle.style.animation = ''; }

  overlay.style.display = 'flex';

  // Substitui os botões para garantir listeners limpos a cada abertura
  const freshBtnLabels = btnLabels.cloneNode(true);
  const freshBtnDash   = btnDash.cloneNode(true);
  btnLabels.replaceWith(freshBtnLabels);
  btnDash.replaceWith(freshBtnDash);

  freshBtnLabels.addEventListener('click', () => {
    overlay.style.display = 'none';
    onGenerateLabels();
  });
  freshBtnDash.addEventListener('click', () => {
    overlay.style.display = 'none';
    onGoToDashboard();
  });
}

// --- Overlay de geração de PDF ---
function showPdfGeneratingAnimation() {
  const o = qs('#overlay-pdf-generating');
  if (o) o.style.display = 'flex';
}
function hidePdfGeneratingAnimation() {
  const o = qs('#overlay-pdf-generating');
  if (o) o.style.display = 'none';
}

// --- Monitor da janela de etiquetas ---
// Trava o botão de submit enquanto a janela de impressão está aberta,
// evitando a criação de novos pedidos com etiquetas ainda sendo visualizadas.
function monitorLabelWindow(printWindow) {
  if (!printWindow) return;
  const submitBtn = qs('.btn-submit-order');
  if (!submitBtn) return;

  const originalText    = submitBtn.textContent;
  submitBtn.disabled    = true;
  submitBtn.textContent = '⏳ Feche as etiquetas para criar outro pedido';
  submitBtn.style.opacity = '0.45';
  submitBtn.style.cursor  = 'not-allowed';

  const watchdog = setInterval(() => {
    if (printWindow.closed) {
      clearInterval(watchdog);
      submitBtn.disabled    = false;
      submitBtn.textContent = originalText;
      submitBtn.style.opacity = '';
      submitBtn.style.cursor  = '';
    }
  }, 600);
}

// --- Submit do formulário ---
async function handleFormSubmit(e) {
  e.preventDefault();

  const clientId    = qs('#order-client').value;       // hidden field populado pelo autocomplete
  const description = qs('#order-description').value.trim();
  const totalQty    = parseInt(qs('#order-total-qty').value);
  const startDate   = qs('#order-start-date').value;
  const dueDate     = qs('#order-due-date').value;

  if (!clientId) return alert('Por favor, selecione um cliente!');
  if (!container) return;

  const boxesArray = [];
  container.querySelectorAll('.box-row').forEach(row => {
    const productId  = parseInt(row.querySelector('.box-product-hidden').value) || null;
    const productQty = parseInt(row.querySelector('.box-qty').value) || 0;
    boxesArray.push({ product_id: productId, product_qty: productQty });
  });

  try {
    let targetOrderId = editOrderId;

    if (editOrderId) {
      // --- MODO ATUALIZAÇÃO (PUT) ---
      const updatePayload = { description, total_qty: totalQty, start_date: startDate, due_date: dueDate, boxes: boxesArray };
      const data = await safeFetchJson(`/api/orders/${editOrderId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(updatePayload)
      });
      if (data.error) return alert(`Erro ao atualizar pedido: ${data.error}`);

    } else {
      // --- MODO CADASTRO (POST) ---
      const firstRow   = container.querySelector('.box-row[data-box-num="1"]');
      const firstProdId = firstRow ? parseInt(firstRow.querySelector('.box-product-hidden').value) : null;
      const firstQty   = firstRow ? parseInt(firstRow.querySelector('.box-qty').value) || 0 : 0;

      const orderPayload = {
        description, total_qty: totalQty, start_date: startDate, due_date: dueDate,
        status: 'pendente',
        firstBox: { product_id: firstProdId, product_qty: firstQty }
      };

      const createdOrder = await safeFetchJson(`/api/clients/${clientId}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(orderPayload)
      });

      if (createdOrder.error) return alert(`Erro: ${createdOrder.error}`);
      targetOrderId = createdOrder.id;

      // TODO: caixa 1 é escrita duas vezes (POST firstBox + PUT abaixo).
      // Resultado final no banco está correto, mas há escrita redundante.
      // Eliminável futuramente ao aceitar criação de pedido sem firstBox.
      if (boxesArray.length > 1) {
        const updatePayload = { description, total_qty: totalQty, start_date: startDate, due_date: dueDate, boxes: boxesArray };
        const updateResult = await safeFetchJson(`/api/orders/${targetOrderId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(updatePayload)
        });
        if (updateResult.error) return alert(`Erro ao salvar caixas: ${updateResult.error}`);
      }
    }

    // Exibe o modal de sucesso (substitui o confirm() nativo)
    showOrderSuccessModal(
      targetOrderId,
      () => generateBarcodeLabels(targetOrderId),
      () => { window.location.href = '/Public/dashboard.html'; }
    );
  } catch (err) {
    console.error(err);
    alert(`Erro de rede ao salvar os dados do pedido: ${err.message}`);
  }
}

// ═══════════════════════════════════════════════════════════
// GERAÇÃO DE ETIQUETAS COM CÓDIGO DE BARRAS
// Algoritmo: CLT{clientId}-ORD{orderId}-CX{boxNumber}-QTY{qty}
// Rendering: JsBarcode via CDN (deve ser idêntico ao bwip-js do servidor)
// ═══════════════════════════════════════════════════════════
async function generateBarcodeLabels(orderId) {
  try {
    showPdfGeneratingAnimation();
    const orderDetails = await safeFetchJson(`/api/orders/${orderId}`, { credentials: 'include' });
    hidePdfGeneratingAnimation();

    if (!orderDetails || !orderDetails.boxes || orderDetails.boxes.length === 0) {
      alert('Erro ou falta de mapeamento de caixas para este lote.');
      window.location.href = '/Public/dashboard.html';
      return;
    }

    const printWindow = window.open('', '_blank', 'width=800,height=700');
    let labelHtml = `
      <html>
      <head>
        <title>Etiquetas - Lote #${orderId}</title>
        <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"><\/script>
        <style>
          body { font-family: Arial, sans-serif; margin: 15px; background: #fff; }
          .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; }
          .label-box { border: 2px dashed #000; padding: 15px; text-align: center; border-radius: 4px; background: #fff; page-break-inside: avoid; }
          .label-title { font-size: 1.1em; font-weight: bold; margin-bottom: 5px; border-bottom: 1px solid #000; padding-bottom: 2px; }
          .label-desc { font-size: 0.85em; text-align: left; line-height: 1.3; margin: 8px 0; }
          .barcode-svg { max-width: 100%; margin: 10px 0; }
          .btn-container { grid-column: span 2; text-align: center; margin-bottom: 10px; }
          .btn-print { background: #2563eb; color: #fff; border: none; padding: 8px 20px; font-weight: bold; border-radius: 4px; cursor: pointer; }
          @media print { .btn-container { display: none; } body { margin: 0; } .label-box { border: 2px solid #000; } }
        </style>
      </head>
      <body>
        <div class="grid">
          <div class="btn-container">
            <button class="btn-print" onclick="window.print()">🖨️ Imprimir Etiquetas</button>
          </div>
    `;

    orderDetails.boxes.forEach(box => {
      labelHtml += `
        <div class="label-box">
          <div class="label-title">PEDIDO N° #${orderId} — CX ${box.box_number}</div>
          <div class="label-desc">
            <strong>Cliente:</strong> ${orderDetails.client_name || '—'}<br/>
            <strong>Descrição:</strong> ${orderDetails.description || '—'}<br/>
            <strong>Qtd na Caixa:</strong> ${box.product_qty} un
          </div>
          <svg class="barcode-svg" id="box-bc-${box.id}"></svg>
        </div>
      `;
    });

    labelHtml += `
        </div>
        <script>
          document.addEventListener("DOMContentLoaded", function() {
    `;

    orderDetails.boxes.forEach(box => {
      // Formato hierárquico único — deve ser idêntico ao gerado pelo servidor
      const codeValue = `CLT${orderDetails.client_id}-ORD${orderId}-CX${box.box_number}-QTY${box.product_qty}`;
      labelHtml += `
            JsBarcode("#box-bc-${box.id}", "${codeValue}", {
              format: "CODE128", width: 2, height: 50, displayValue: true, fontSize: 12
            });
      `;
    });

    labelHtml += `
          });
        <\/script>
      </body>
      </html>
    `;

    printWindow.document.write(labelHtml);
    printWindow.document.close();
    monitorLabelWindow(printWindow);    // ← trava o submit enquanto a janela está aberta

  } catch (err) {
    hidePdfGeneratingAnimation();
    alert(`Erro ao carregar dados da impressão de etiquetas: ${err.message}`);
  }
}
// --- Modais de cliente / produto ---
function setupModalActions() {

  // Clientes 
  const btnSaveClient = qs('#btn-save-client');
  if (btnSaveClient) {
    btnSaveClient.addEventListener('click', async () => {
      const action = document.querySelector('input[name="client-action"]:checked')?.value || 'add';

      if (action === 'add') {
        const name = qs('#new-client-name').value.trim();
        if (!name) return alert('Digite o nome do cliente!');

        try {
          const data = await safeFetchJson('/api/clients', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ name })
          });
          if (data.error) return alert(`Erro: ${data.error}`);

          qs('#new-client-name').value = '';
          closeModal('modal-client');
          await loadClients();

          // Auto-seleciona o cliente recém-criado no autocomplete
          const input  = qs('#order-client-input');
          const hidden = qs('#order-client');
          if (input)  input.value  = name;
          if (hidden) hidden.value = data.id;
        } catch (err) {
          alert(`Erro ao salvar cliente: ${err.message}`);
        }
      } else {
        const clientId = qs('#delete-client-select').value;
        if (!clientId) return alert('Selecione um cliente para excluir!');
        if (!confirm('Tem certeza absoluta que deseja deletar este cliente e TODOS os seus pedidos?')) return;

        try {
          const data = await safeFetchJson(`/api/clients/${clientId}`, { method: 'DELETE', credentials: 'include' });
          if (data.error) return alert(`Erro: ${data.error}`);

          alert('Cliente deletado com sucesso!');
          closeModal('modal-client');
          await loadClients();
        } catch (err) {
          alert(`Erro ao deletar cliente: ${err.message}`);
        }
      }
    });
  }

  // --- Produtos ---
  const btnSaveProduct = qs('#btn-save-product');
  if (btnSaveProduct) {
    btnSaveProduct.addEventListener('click', async () => {
      const action = document.querySelector('input[name="product-action"]:checked')?.value || 'add';

      if (action === 'add') {
        const code        = qs('#new-prod-code').value.trim();
        const description = qs('#new-prod-desc').value.trim();
        const weight_grams = parseInt(qs('#new-prod-weight').value);

        if (!code || !weight_grams) return alert('Código e Peso são obrigatórios!');

        try {
          const data = await safeFetchJson('/api/products', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ code, description, weight_grams })
          });
          if (data.error) return alert(`Erro: ${data.error}`);

          qs('#new-prod-code').value   = '';
          qs('#new-prod-desc').value   = '';
          qs('#new-prod-weight').value = '';
          closeModal('modal-product');
          await loadProducts();
        } catch (err) {
          alert(`Erro ao salvar produto: ${err.message}`);
        }
      } else {
        const productId = qs('#delete-product-select').value;
        if (!productId) return alert('Selecione um produto para excluir!');
        if (!confirm('Confirmar exclusão deste produto do catálogo?')) return;

        try {
          const data = await safeFetchJson(`/api/products/${productId}`, { method: 'DELETE', credentials: 'include' });
          if (data.error) return alert(`Erro: ${data.error}`);

          alert('Produto removido com sucesso!');
          closeModal('modal-product');
          await loadProducts();
        } catch (err) {
          alert(`Erro ao deletar produto: ${err.message}`);
        }
      }
    });
  }
}

// --- Inicialização ---
document.addEventListener('DOMContentLoaded', async () => {
  initThemeToggle();     // ← adicionado do arquivo pesado
  setDefaultDates();
  setupModalActions();

  await Promise.all([loadClients(), loadProducts()]).catch(err => {
    console.error('Falha ao inicializar dados essenciais:', err);
  });

  const urlParams = new URLSearchParams(window.location.search);
  const editId    = urlParams.get('edit');

  if (editId) {
    await setupEditMode(editId);
  } else {
    createBoxRow(0);    // linha vazia padrão apenas para novo cadastro
  }

  updateBalances();

  const totalQtyInput = qs('#order-total-qty');
  if (totalQtyInput) totalQtyInput.addEventListener('input', updateBalances);

  const btnAddBox = qs('#btn-add-box');
  if (btnAddBox) btnAddBox.addEventListener('click', () => { createBoxRow(0); updateBalances(); });

  const btnSuggest = qs('#btn-suggest');
  if (btnSuggest) btnSuggest.addEventListener('click', suggestDivision);

  const form = qs('#new-order-form');
  if (form) form.addEventListener('submit', handleFormSubmit);
});