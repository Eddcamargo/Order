// dashboard.js — Controlador da Tela de Monitoramento de Produção 

/**
 * Atalho para document.querySelector
 * @param {string} selector 
 * @returns {Element|null}
 */
function qs(selector) { 
  return document.querySelector(selector); 
}

/**
 * Converte string de data no formato 'YYYY-MM-DD' para um objeto Date local
 * @param {string} str 
 * @returns {Date|null}
 */
function parseDateString(str) {
  if (!str) return null;
  const [year, month, day] = str.split('-');
  return new Date(year, month - 1, day);
}

/**
 * Formata uma data vinda do Banco de Dados (YYYY-MM-DD) para o padrão brasileiro (DD/MM/YYYY).
 * @param {string} str 
 * @returns {string}
 */
function formatDate(str) {
  if (!str) return '-';
  const [year, month, day] = str.split('-');
  return `${day}/${month}/${year}`;
}

// --- Comportamento de interface interna ---

// Listener global para fechar os menus suspensos de ações (engrenagem) caso o usuário clique fora
document.addEventListener('click', () => {
  document.querySelectorAll('.gear-menu').forEach(menu => menu.classList.add('hidden'));
});

/**
 * Busca os dados do servidor e renderiza as métricas e tabelas do Dashboard
 */
async function loadDashboard() {
  const tbody = qs('#dashboard-tbody');
  if (!tbody) return;
  
  try {
    // Busca ordens vinculadas ao usuário/contexto ativo
    const res = await fetch('/api/orders/user', { credentials: 'include' });

    if (!res.ok) {
      throw new Error(`HTTP erro! Status: ${res.status}`);
    }

    const orders = await res.json();
    
    // Contadores para os Cards Informativos do topo
    let totalInProduction = 0;
    let totalAlerta = 0;
    let totalAtrasado = 0;
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Limpa a tabela antes de renderizar as novas linhas
    tbody.innerHTML = '';

    if (orders.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="no-orders">Nenhum pedido em produção no momento.</td></tr>`;
      updateCounters(0, 0, 0);
      return;
    }

    // Processamento e montagem das linhas do Grid
    orders.forEach(order => {
      // 1. Calcule a porcentagem de progresso para alimentar a barra visual
      const percent = order.total_qty ? Math.round((order.current_qty / order.total_qty) * 100) : 0;

      // 2. Validação de prazos (Alertas e Atrasos) e definição da classe CSS
      const dueDate = parseDateString(order.due_date);
      let statusPrazoClass = '';
      
      if (dueDate) {
        const diffTime = dueDate.getTime() - today.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays < 0) {
          totalAtrasado++;
          statusPrazoClass = 'text-atrasado'; // Classe CSS customizável para itens vencidos
        } else if (diffDays <= 2) {
          totalAlerta++;
          statusPrazoClass = 'text-alerta'; // Classe CSS para itens próximos do vencimento
        }
      }

      // 3. Criação da linha HTML (Elemento TR)
      const tr = document.createElement('tr');
      totalInProduction++;

      // 4. Define o conteúdo da linha baseado na estrutura correta com a barra de progresso
      tr.innerHTML = `
        <td><strong>#${order.client_order_number || order.id}</strong></td>
        <td>${order.client_name || 'Não Informado'}</td>
        <td>${order.description || '-'}</td>
        <td>
          <div class="progress-wrapper">
            <div class="progress-container">
              <div class="progress-bar" style="width: ${percent}%;"></div>
              <div class="progress-text">${order.current_qty || 0} / ${order.total_qty || 0} (${percent}%)</div>
            </div>
          </div>
        </td>
        <td class="${statusPrazoClass}">${formatDate(order.due_date)}</td>
        <td><span class="badge badge-${order.status || 'aberto'}">${(order.status || 'aberto').toUpperCase()}</span></td>
        <td class="text-center" style="position: relative;">
          <button class="btn-gear" onclick="toggleGearMenu(event, '${order.id}')">⚙️</button>
          <div id="gear-menu-${order.id}" class="gear-menu hidden">
            <button class="btn-edit-order" data-id="${order.id}">✏️ Editar</button>
            <button class="btn-delete-order" data-id="${order.id}" style="color: #dc3545;">🗑️ Excluir</button>
          </div>
        </td>
      `;

      // Evento Dinâmico para Excluir Pedido
      tr.querySelector(`.btn-delete-order`).addEventListener('click', async () => {
        const identifier = order.client_order_number || order.id;
        if (confirm(`Tem certeza absoluta de que deseja excluir permanentemente o pedido #${identifier}? Esta ação não pode ser desfeita.`)) {
          try {
            const deleteRes = await fetch(`/api/orders/${order.id}`, { 
              method: 'DELETE', 
              credentials: 'include' 
            });
            const deleteData = await deleteRes.json();
            
            if (deleteData.error) {
              alert(`Erro: ${deleteData.error}`);
            } else {
              alert('Pedido removido com sucesso!');
              loadDashboard(); // Recarrega os dados locais atualizados
            }
          } catch (err) {
            console.error('Erro ao excluir pedido:', err);
            alert('Erro de comunicação com o servidor ao tentar excluir.');
          }
        }
      });

      // Evento Dinâmico para Editar Pedido
      tr.querySelector(`.btn-edit-order`).addEventListener('click', () => {
        // Redireciona para a tela de planejamento passando o ID na URL para edição
        window.location.href = `/Public/novo-pedido.html?edit=${order.id}`;
      });

      // Adiciona a linha estruturada ao corpo da tabela
      tbody.appendChild(tr);
    });

    // Atualiza os painéis informativos superiores com os contadores finais calculados
    updateCounters(totalInProduction, totalAlerta, totalAtrasado);

  } catch (err) {
    console.error('Erro ao renderizar o Dashboard:', err);
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="no-orders" style="color: #dc3545; font-weight: bold;">
          ⚠️ Falha ao carregar métricas do servidor. Verifique a conexão ou o terminal do backend.
        </td>
      </tr>
    `;
  }
}

/**
 * Altera a visibilidade do menu de ações (Engrenagem) de uma linha específica
 * @param {Event} event 
 * @param {string|number} orderId 
 */
function toggleGearMenu(event, orderId) {
  event.stopPropagation(); // Evita disparar o clique do document que fecha todos os menus
  
  // Fecha qualquer outro menu aberto primeiro
  document.querySelectorAll('.gear-menu').forEach(menu => {
    if (menu.id !== `gear-menu-${orderId}`) {
      menu.classList.add('hidden');
    }
  });

  // Alterna o estado do menu atual
  const currentMenu = qs(`#gear-menu-${orderId}`);
  if (currentMenu) {
    currentMenu.classList.toggle('hidden');
  }
}

/**
 * Atualiza os valores em texto dos cards de indicadores superiores
 * @param {number} total 
 * @param {number} alerta 
 * @param {number} atrasado 
 */
function updateCounters(total, alerta, atrasado) {
  if (qs('#count-total')) qs('#count-total').textContent = total;
  if (qs('#count-alerta')) qs('#count-alerta').textContent = alerta;
  if (qs('#count-atrasado')) qs('#count-atrasado').textContent = atrasado;
}

// Inicializa o Dashboard assim que a estrutura do DOM estiver totalmente carregada
document.addEventListener('DOMContentLoaded', loadDashboard);

// No final do arquivo, após o DOMContentLoaded existente:
document.addEventListener('DOMContentLoaded', () => {
  loadDashboard();
  setInterval(loadDashboard, 8000); // Atualiza a cada 8s automaticamente
});