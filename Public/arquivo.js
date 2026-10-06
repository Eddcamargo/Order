// arquivo.js — Controlador da Página de Arquivo de Pedidos
function qs(s) { return document.querySelector(s); }

// --- Estado ---
let allArchivedOrders = [];
let filteredOrders = [];
let currentPage = 1;
const PAGE_SIZE = 25;

// --- Feedback ---
function showFeedback(message, isError = false) {
  const el = qs('#archive-feedback');
  if (!el) return;
  el.textContent = message;
  el.className = 'feedback-box ' + (isError ? 'feedback-error' : 'feedback-success');
  setTimeout(() => { el.className = 'feedback-box'; el.textContent = ''; }, 6000);
}

// --- Paginação ---
function updatePagination() {
  const totalPages = Math.ceil(filteredOrders.length / PAGE_SIZE);
  const controls = qs('#pagination-controls');
  if (totalPages <= 1) {
    controls.style.display = 'none';
    return;
  }
  controls.style.display = 'flex';
  qs('#page-info').textContent = `Página ${currentPage} de ${totalPages}`;
  qs('#btn-prev-page').disabled = currentPage <= 1;
  qs('#btn-next-page').disabled = currentPage >= totalPages;
}

function getCurrentPageItems() {
  const start = (currentPage - 1) * PAGE_SIZE;
  return filteredOrders.slice(start, start + PAGE_SIZE);
}

// --- Renderização da tabela --- 
function renderArchiveTable() {
  const tbody = qs('#archive-tbody');
  const countEl = qs('#archive-count');
  const pageItems = getCurrentPageItems();

  const total = filteredOrders.length;
  if (allArchivedOrders.length !== filteredOrders.length) {
    countEl.textContent = `${total} de ${allArchivedOrders.length} pedido(s)`;
  } else {
    countEl.textContent = `${total} pedido(s) arquivado(s)`;
  }

  if (pageItems.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="no-data">Nenhum pedido encontrado com os filtros aplicados.</td></tr>`;
    updatePagination();
    return;
  }

  tbody.innerHTML = pageItems.map((order, idx) => {
    const globalIdx = (currentPage - 1) * PAGE_SIZE + idx;
    const boxCount = order.box_count ?? order.boxes?.length ?? '—';
    const label = `#${order.client_order_number || order.order_id}`;

    return `
      <tr data-order-id="${order.order_id}">
        <td><strong>${label}</strong></td>
        <td>${order.client_name || 'Não Informado'}</td>
        <td style="font-size:0.85rem;">${
          order.product_code
            ? `${order.product_code} - ${order.product_description || ''}`
            : (order.product_description || '—')
        }</td>
        <td class="text-center">
          <span style="font-weight:700; color:#0284c7;">${boxCount} cx</span>
        </td>
        <td style="font-size:0.85rem; white-space:nowrap;">${order.dispatched_at || '—'}</td>
        <td style="font-size:0.85rem; white-space:nowrap;">${order.archived_at || '—'}</td>
        <td class="text-center col-pdf">
          <button class="btn-pdf-icon" data-order-id="${order.order_id}" title="Abrir PDF do pedido ${label}">📄</button>
        </td>
        <td class="text-center">
          <div class="gear-wrapper">
            <button class="btn-gear" data-idx="${globalIdx}">⚙️</button>
            <div class="gear-menu hidden" id="arch-menu-${globalIdx}">
              <button class="btn-unarchive" data-order-id="${order.order_id}">↩️ Desarquivar</button>
              <button class="btn-delete-order" data-order-id="${order.order_id}" style="color:var(--danger-glow);">🗑️ Excluir</button>
            </div>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  attachTableListeners();
  updatePagination();
}

// --- Listeners da tabela --- 
function attachTableListeners() {
  const tbody = qs('#archive-tbody');

  // Ícone de PDF (NOVO — acesso direto)
  tbody.querySelectorAll('.btn-pdf-icon').forEach(btn => {
    btn.addEventListener('click', async () => {
      const orderId = btn.getAttribute('data-order-id');
      btn.disabled = true;
      btn.textContent = '⏳';
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
      } finally {
        btn.disabled = false;
        btn.textContent = '📄';
      }
    });
  });

  // --- Gear menus ---
  tbody.querySelectorAll('.btn-gear').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('.gear-menu').forEach(m => m.classList.add('hidden'));
      qs(`#arch-menu-${btn.getAttribute('data-idx')}`).classList.remove('hidden');
    });
  });

  // --- Desarquivar ---
  tbody.querySelectorAll('.btn-unarchive').forEach(btn => {
    btn.addEventListener('click', async () => {
      const orderId = btn.getAttribute('data-order-id');
      const order = allArchivedOrders.find(o => String(o.order_id) === String(orderId));
      const label = order ? `#${order.client_order_number || orderId}` : `#${orderId}`;
      if (!confirm(`Deseja restaurar o pedido ${label} para a lista ativa de expedição?`)) return;
      try {
        const res = await fetch(`/api/orders/${orderId}/unarchive`, {
          method: 'POST', credentials: 'include'
        });
        const data = await res.json();
        if (data.success) {
          showFeedback(`Pedido ${label} restaurado com sucesso!`);
          removeOrderFromList(orderId);
        } else {
          alert('Erro ao desarquivar: ' + (data.error || 'Desconhecido'));
        }
      } catch {
        alert('Erro de comunicação com o servidor.');
      }
    });
  });

  // --- Excluir permanentemente ---
  tbody.querySelectorAll('.btn-delete-order').forEach(btn => {
    btn.addEventListener('click', async () => {
      const orderId = btn.getAttribute('data-order-id');
      const order = allArchivedOrders.find(o => String(o.order_id) === String(orderId));
      const label = order ? `#${order.client_order_number || orderId}` : `#${orderId}`;
      if (!confirm(`⚠️ ATENÇÃO: Deseja excluir permanentemente o pedido ${label}?\n\nEsta ação não pode ser desfeita.`)) return;
      try {
        const res = await fetch(`/api/orders/${orderId}/delete`, {
          method: 'POST', credentials: 'include'
        });
        const data = await res.json();
        if (data.success) {
          showFeedback(`Pedido ${label} excluído.`);
          removeOrderFromList(orderId);
        } else {
          alert('Erro ao excluir: ' + (data.error || 'Desconhecido'));
        }
      } catch {
        alert('Erro de comunicação com o servidor.');
      }
    });
  });
}

function removeOrderFromList(orderId) {
  allArchivedOrders = allArchivedOrders.filter(o => String(o.order_id) !== String(orderId));
  applyFilters();
}

// --- Filtros (com busca textual aprimorada) ---
function applyFilters() {
  const searchVal = qs('#archive-search').value.trim().toLowerCase();
  const dateFrom = qs('#filter-date-from').value;
  const dateTo = qs('#filter-date-to').value;

  filteredOrders = allArchivedOrders.filter(order => {
    // Filtro de texto — pesquisa em múltiplos campos (pedido, cliente, produto)
    if (searchVal) {
      const haystack = [
        order.client_name,
        order.client_order_number,
        String(order.order_id),
        order.product_code,
        order.product_description
      ].join(' ').toLowerCase();

      if (!haystack.includes(searchVal)) return false;
    }

    // Filtro de data
    if (dateFrom || dateTo) {
      const rawDate = order.archived_at_iso || order.archived_at;
      if (rawDate) {
        const d = new Date(rawDate);
        if (dateFrom && d < new Date(dateFrom)) return false;
        if (dateTo && d > new Date(dateTo + 'T23:59:59')) return false;
      }
    }
    return true;
  });

  currentPage = 1;
  renderArchiveTable();
}

// --- Carregamento inicial ---
async function loadArchivedOrders() {
  const tbody = qs('#archive-tbody');
  const countEl = qs('#archive-count');
  tbody.innerHTML = `<tr class="loading-row"><td colspan="8">Carregando pedidos arquivados...</td></tr>`;
  countEl.textContent = 'Carregando...';

  try {
    const res = await fetch('/api/orders/archived', { credentials: 'include' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    allArchivedOrders = Array.isArray(data) ? data : (data.orders || []);

    allArchivedOrders.sort((a, b) => {
      const da = new Date(a.archived_at_iso || a.archived_at || 0);
      const db = new Date(b.archived_at_iso || b.archived_at || 0);
      return db - da;
    });

    applyFilters();
  } catch (err) {
    console.error('Erro ao carregar arquivo:', err);
    countEl.textContent = 'Erro ao carregar.';
    tbody.innerHTML = `<tr>
      <td colspan="8" class="no-data" style="color:var(--danger-glow);">
        ⚠️ Falha ao carregar os pedidos arquivados. Verifique sua conexão e tente novamente.
      </td>
    </tr>`;
  }
}

// --- Inicialização ---
document.addEventListener('click', (e) => {
  if (!e.target.closest('.gear-wrapper')) {
    document.querySelectorAll('.gear-menu').forEach(m => m.classList.add('hidden'));
  }
});

document.addEventListener('DOMContentLoaded', () => {
  loadArchivedOrders();

  // Busca com debounce para não travar em listas grandes
  let debounceTimer;
  qs('#archive-search').addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(applyFilters, 250);
  });

  qs('#filter-date-from').addEventListener('change', applyFilters);
  qs('#filter-date-to').addEventListener('change', applyFilters);

  qs('#btn-clear-filter').addEventListener('click', () => {
    qs('#archive-search').value = '';
    qs('#filter-date-from').value = '';
    qs('#filter-date-to').value = '';
    applyFilters();
  });

  qs('#btn-refresh-archive').addEventListener('click', loadArchivedOrders);

  qs('#btn-prev-page').addEventListener('click', () => {
    if (currentPage > 1) { currentPage--; renderArchiveTable(); }
  });
  qs('#btn-next-page').addEventListener('click', () => {
    const totalPages = Math.ceil(filteredOrders.length / PAGE_SIZE);
    if (currentPage < totalPages) { currentPage++; renderArchiveTable(); }
  });
});