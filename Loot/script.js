// indocumentavel, codigo muito sujo e parcialmente reaproveitado de outro projeto, mas funciona e é funcional
document.addEventListener('DOMContentLoaded', () => {
  const mainScreen = document.getElementById('main-screen');
  const createLotScreen = document.getElementById('create-lot-screen');
  const summaryScreen = document.getElementById('summary-screen');

  const finalizedSelect = document.getElementById('finalizedSelect');
  const newLotFromOrder = document.getElementById('newLotFromOrder');

  const scanSection = document.querySelector('.scan-section');
  const codigoInput = document.getElementById('codigoInput');
  const scannedItemsList = document.getElementById('scannedItemsList');
  const totalCaixasSpan = document.getElementById('totalCaixas');
  const pesoTotalSpan = document.getElementById('pesoTotal');
  const finishLotBtn = document.getElementById('finishLotBtn');
  const resultadoParagrafo = document.getElementById('resultado');

  const finalSummaryDetails = document.getElementById('finalSummaryDetails');
  const printReportBtn = document.getElementById('printReportBtn');
  const backToMainBtn = document.getElementById('backToMainBtn');
  const backToMainFromCreateBtn = document.getElementById('backToMainFromCreateBtn');
  const lotTitle = document.getElementById('lotTitle');

  let currentLot = { name:'', items:[], totalCaixas:0, pesoTotal:0 };

  function showScreen(s) {
    [mainScreen, createLotScreen, summaryScreen].forEach(x=>x.classList.remove('active'));
    s.classList.add('active');
  }
  function resetLot(){
    currentLot = { name:'', items:[], totalCaixas:0, pesoTotal:0 };
    scannedItemsList.innerHTML='';
    totalCaixasSpan.textContent='0';
    pesoTotalSpan.textContent='0kg';
    resultadoParagrafo.textContent='';
  }
  function updateLotSummary(){
    totalCaixasSpan.textContent = currentLot.totalCaixas;
    pesoTotalSpan.textContent = (currentLot.pesoTotal/1000).toFixed(2)+'kg';
  }

async function loadFinalized() {
  finalizedSelect.innerHTML = '<option value="">-- selecione --</option>';
  try {
    const r = await fetch('/api/orders/finalized', { credentials: 'include' });
    if (!r.ok) {
      console.error('Error loading finalized orders:', r.status);
      alert('Falha ao carregar pedidos finalizados: ' + r.status);
      return;
    }
    const list = await r.json();
    list.forEach(o => {
      const op = document.createElement('option');
      op.value = o.id;

      // Since the order is finalized, current_qty = total_qty
      const totalQty = o.total_qty || 0;
      const currentQty = totalQty; // Always show full progress for finalized orders

      op.textContent = `#${o.id} — ${o.description} (${currentQty}/${totalQty})`;
      finalizedSelect.appendChild(op);
    });
  } catch (e) {
    console.error('Fetch error:', e);
    alert('Erro ao carregar pedidos finalizados');
  }
}

  newLotFromOrder.addEventListener('click', ()=>{
    const id = finalizedSelect.value;
    const text = finalizedSelect.options[finalizedSelect.selectedIndex]?.textContent || '';
    if(!id) return alert('Selecione um pedido finalizado');
    resetLot();
    currentLot.name = text;
    lotTitle.textContent = text;
    scanSection.style.display='block';
    showScreen(createLotScreen);
    codigoInput.focus();
  });

  async function verificarCodigo() {
  const codigo = codigoInput.value.trim();
  if (!codigo) {
    resultadoParagrafo.textContent = 'Escaneie um código.';
    return;
  }
  codigoInput.value = ''; // Clear input
  resultadoParagrafo.textContent = 'Verificando...';

  try {
    const response = await fetch('/loot/verificar-codigo', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'include',  // Important: keeps session (admin login)
      body: JSON.stringify({ codigo_barra: codigo })
    });

    // Check if response is OK (200-299)
    if (!response.ok) {
      const errorText = await response.text();
      console.error('HTTP Error:', response.status, errorText);
      resultadoParagrafo.textContent = `Erro: ${response.status}`;
      return;
    }

    const result = await response.json();

    if (result.existe) {
      const item = result.data;
      currentLot.items.push(item);
      currentLot.totalCaixas += (item.quantidade || 1);
      currentLot.pesoTotal += (item.peso_gramas || 0);

      const li = document.createElement('li');
      li.dataset.codigoBarra = item.codigo_barra;

      const text = document.createElement('span');
      text.textContent = `${item.codigo_barra} | ${item.descricao} | ${item.quantidade || 1} un`;

      const removeBtn = document.createElement('button');
      removeBtn.textContent = 'remover';
      removeBtn.className = 'remove-item-btn';
      removeBtn.addEventListener('click', () => {
        const idx = currentLot.items.findIndex(i => i.codigo_barra === item.codigo_barra);
        if (idx > -1) {
          currentLot.totalCaixas -= (currentLot.items[idx].quantidade || 1);
          currentLot.pesoTotal -= (currentLot.items[idx].peso_gramas || 0);
          currentLot.items.splice(idx, 1);
          li.remove();
          updateLotSummary();
        }
      });

      li.appendChild(text);
      li.appendChild(removeBtn);
      scannedItemsList.appendChild(li);

      resultadoParagrafo.textContent = 'Código ok';
      updateLotSummary();
    } else {
      resultadoParagrafo.textContent = 'Código não encontrado';
    }
  } catch (e) {
    console.error('Erro ao verificar código:', e);
    resultadoParagrafo.textContent = 'Erro: falha na conexão';
  } finally {
    codigoInput.focus();
  }
}

  codigoInput.addEventListener('keypress', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); verificarCodigo(); } });

  finishLotBtn.addEventListener('click', ()=>{
    if(currentLot.items.length===0){ alert('O lote está vazio'); return; }
    showScreen(summaryScreen);
    finalSummaryDetails.innerHTML = `
      <p><strong>Pedido/Lote:</strong> ${currentLot.name}</p>
      <p><strong>Data:</strong> ${new Date().toLocaleString()}</p>
      <p><strong>Total de Itens:</strong> ${currentLot.totalCaixas}</p>
      <p><strong>Peso Total:</strong> ${(currentLot.pesoTotal/1000).toFixed(2)} kg</p>
      <h3>Itens:</h3>
      <ul>${currentLot.items.map(it=>`<li>${it.codigo_barra} — ${it.descricao} — ${it.quantidade||1} un — ${(it.peso_gramas/1000).toFixed(2)} kg</li>`).join('')}</ul>
    `;
  });

printReportBtn.addEventListener('click', async () => {
  if (currentLot.items.length === 0) {
    alert('O lote está vazio');
    return;
  }

  // Get the order ID from the dropdown
  const orderId = finalizedSelect.value;

  // Add orderId and formatted name to the lot data
  const lotData = {
    ...currentLot,
    orderId: orderId ? parseInt(orderId) : null,
    name: currentLot.name || `Lote Manual - ${new Date().toLocaleString()}`
  };

  try {
    const response = await fetch('/loot/gerar-relatorio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(lotData)
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${response.status}`);
    }

    // Download the PDF
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `relatorio_lote_pedido_${orderId || 'manual'}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    // Optional: show success
    alert('✅ PDF gerado e salvo com sucesso!');

  } catch (err) {
    console.error('Erro ao gerar PDF:', err);
    alert('❌ Falha ao gerar PDF: ' + err.message);
  }
});

  backToMainBtn.addEventListener('click', ()=>{ showScreen(mainScreen); resetLot(); loadFinalized(); });
  backToMainFromCreateBtn.addEventListener('click', ()=>{ showScreen(mainScreen); resetLot(); loadFinalized(); });

  // init
  loadFinalized();
});
