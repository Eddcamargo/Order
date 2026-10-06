// order.js — Controlador do Hub de Navegação Principal

// ---------- Funções Utilitárias ----------
function qs(s) { return document.querySelector(s); }
function qsa(s) { return document.querySelectorAll(s); }

// Requisição POST auxiliar <-- correção de bug que eu não achei 
async function jpost(url, data) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(data)
  });

  const contentType = r.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return { error: `Servidor respondeu com status ${r.status} sem JSON válido.` };
  }

  return r.json();
}

// Controla exibição de blocos da interface
function showSection(sectionId) {
  qs('#login-section').classList.add('hidden');
  qs('#menu-section').classList.add('hidden');
  
  qs(`#${sectionId}`).classList.remove('hidden');
}

// --- Gerenciamento de interfaces ---
function enterSystem(user) {
  if (!user) return showSection('login-section');

  showSection('menu-section');
  const displayEl = qs('#user-display');
  if (displayEl) {
    const roleBadge = user.role === 'admin' ? 'Administrador' : 'Operador';
    displayEl.textContent = '';

    const prefix = document.createTextNode('Conectado como: ');
    const strong = document.createElement('strong');
    strong.textContent = user.username; // textContent nunca interpreta HTML
    const suffix = document.createTextNode(` (${roleBadge})`);

    displayEl.append(prefix, strong, suffix);
  }

  // --- Controle de acesso por perfil de usuário ---
  const btnDashboard  = qs('#btn-goto-dashboard');
  const btnNovoPedido = qs('#btn-goto-novo-pedido');
  const btnExpedicao  = qs('#btn-goto-expedicao');
  const btnProducao   = qs('#btn-goto-producao');

  if (user.role === 'admin') {
    if (btnDashboard)  btnDashboard.classList.remove('hidden');
    if (btnNovoPedido) btnNovoPedido.classList.remove('hidden');
    if (btnExpedicao)  btnExpedicao.classList.remove('hidden');
    if (btnProducao)   btnProducao.classList.add('hidden');
  } else {
    if (btnDashboard)  btnDashboard.classList.add('hidden');
    if (btnNovoPedido) btnNovoPedido.classList.add('hidden');
    if (btnExpedicao)  btnExpedicao.classList.add('hidden');
    if (btnProducao)   btnProducao.classList.remove('hidden');
  }
}

// Verifica sessão persistente ao carregar a página
async function checkSession() {
  try {
    const res = await fetch('/api/me', { credentials: 'include' });
    const data = await res.json();
    if (data.user) {
      enterSystem(data.user);
    } else {
      enterSystem(null);
    }
  } catch (err) {
    console.error('Erro de comunicação com o servidor:', err);
    enterSystem(null);
  }
}

// --- Event listeners ---
document.addEventListener('DOMContentLoaded', () => {
  checkSession();

  // Submissão do Formulário de Login
  qs('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = qs('#username').value.trim();
    const password = qs('#password').value.trim();
    try {
      const response = await jpost('/api/login', { username, password });
      if (response.error) {
        alert(response.error);
      } else {
        enterSystem(response.user);
      }
    } catch (err) {
      console.error('Erro inesperado no login:', err);
      alert('Falha de comunicação com o servidor. Verifique a conexão e tente novamente.');
    }
  });

  // Botão de Logout
  qsa('.btn-logout').forEach(b => b.addEventListener('click', async () => {
    try {
      await jpost('/api/logout', {});
      location.reload(); // Recarrega a página limpando a sessão do usuário
    } catch (err) {
      console.error('Erro ao efetuar logout:', err);
    }
  }));

  // --- Redirecionamento de telas ---
  
  // Direciona para a Tela 1: Dashboard (Apenas Admin)
  if (qs('#btn-goto-dashboard')) {
    qs('#btn-goto-dashboard').addEventListener('click', () => {
      window.location.href = '/Public/dashboard.html';
    });
  }

  // Direciona para a Tela 2: Criação de Pedidos (Apenas Admin)
  if (qs('#btn-goto-novo-pedido')) {
    qs('#btn-goto-novo-pedido').addEventListener('click', () => {
      window.location.href = '/Public/novo-pedido.html';
    });
  }

  // Direciona para a Nova Tela: Posto de Trabalho / Produção (Exclusivo Worker)
  if (qs('#btn-goto-producao')) {
    qs('#btn-goto-producao').addEventListener('click', () => {
      window.location.href = '/Public/producao.html';
    });
  }

  // Direciona para a Tela de Expedição (Exclusivo Admin)
  if (qs('#btn-goto-expedicao')) {
    qs('#btn-goto-expedicao').addEventListener('click', () => {
      window.location.href = '/Public/expedicao.html';
    });
  }
});