// caminhos e dependências

const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const PDFDocument = require('pdfkit');
const bwipjs = require('bwip-js');
const os = require('os');
const { execSync } = require('child_process');

//importação do db.js
const dbModule = require(path.join(process.cwd(), 'db.js'));

//fix de codigo lixo 
async function withDB(callback) {
  return callback(await dbModule.getDb());
}

//es-get-iterator fix (mecanismo do pdfkit/fontkit para compilados .exe com pkg)
function requireEsGetIterator() {
  try {
    return require('es-get-iterator');
  } catch (err) {
    return require(path.join(process.cwd(), 'node_modules', 'es-get-iterator', 'node.js'));
  }
}
//esgetiterator ainda vai me matar 
requireEsGetIterator(); // pré-carrega módulo para compatibilidade com pkg

//inicia express 
const app = express();
const PORT = process.env.PORT || 3000;

//pasta raiz de PDFs
const pdfDir = path.join(process.cwd(), 'Public', 'pdfs');
if (!fs.existsSync(pdfDir)) {
  fs.mkdirSync(pdfDir, { recursive: true });
}

//cria atalho no desktop do user 
function criarAtalhoNoDesktop(targetFolder) {
  if (process.platform !== 'win32') return; // Executa apenas se for ambiente Windows
  try {
    const desktopPath = path.join(os.homedir(), 'Desktop');
    const shortcutPath = path.join(desktopPath, 'Atalho PDFs do Sistema.lnk');

    // Se o atalho já existir, não refaz para poupar processamento
    if (!fs.existsSync(shortcutPath)) {
      const psCommand = `powershell -Command "$wsh = New-Object -ComObject WScript.Shell; $s = $wsh.CreateShortcut('${shortcutPath}'); $s.TargetPath = '${targetFolder}'; $s.Save()"`;
      execSync(psCommand);
      console.log(`[Atalho] Criado com sucesso na Área de Trabalho!`);
    }
  } catch (err) {
    console.warn(`[Atalho] Não foi possível gerar o atalho no Desktop:`, err.message);
  }
}

//cria pasta pro mes atual dentro da pasta raiz
function obterPastaMesAtual() {
  const meses = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const agora = new Date();
  return `${agora.getFullYear()}-${meses[agora.getMonth()]}`; // Retorna ex: "2026-maio"
}

// --- API'S NESCESSARIAS ---
app.use('/pdfs', express.static(pdfDir)); // Serve subpastas de PDFs geradas dinamicamente
app.use('/Public', express.static(path.join(process.cwd(), 'Public')));
app.use('/Loot', express.static(path.join(process.cwd(), 'Loot')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// FIX: Secret agora vem de variável de ambiente. Para desenvolvimento local, crie um
// arquivo .env com SESSION_SECRET=sua-chave-secreta-longa e use o pacote 'dotenv',
// ou defina a variável direto no terminal antes de iniciar: set SESSION_SECRET=suachave
// NUNCA commite segredos hardcoded no código-fonte.
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-fallback-troque-em-producao',
  resave: false,
  saveUninitialized: false,
  // FIX: httpOnly: true impede que JavaScript do navegador leia o cookie de sessão,
  // bloqueando ataques de roubo de sessão via XSS. sameSite: 'lax' protege contra CSRF.
  cookie: { secure: false, httpOnly: true, sameSite: 'lax' }
}));

//middleware de autenticação com hierarquia
function requireLogin(role) {
  return (req, res, next) => {
    if (!req.session.user) {
      return res.status(401).json({ error: 'Não autenticado' });
    }
    // Proteção: Se a rota exige admin, barra os operadores ('user')
    if (role === 'admin' && req.session.user.role !== 'admin') {
      return res.status(403).json({ error: 'Acesso negado: Permissão de Administrador necessária.' });
    }
    next();
  };
}

//---ROTAS DE PAGINAS (HTML) ---
app.get('/', (req, res) => res.redirect('/order'));
app.get('/order', (req, res) => res.sendFile(path.join(process.cwd(), 'Public', 'order.html')));
app.get('/loot', requireLogin('admin'), (req, res) => res.sendFile(path.join(process.cwd(), 'Loot', 'index.html')));

//rotas de autenticação (Login / Logout)
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Usuário e senha são obrigatórios' });
    }

    //busca estrita na tabela users usando o método nativo do SQLite
    const u = await withDB(async (db) => {
      return await db.get('SELECT id, username, password_hash, role FROM users WHERE username = ?', username);
    });

    if (!u) return res.status(400).json({ error: 'Usuário não encontrado' });
    
    const ok = await bcrypt.compare(password, u.password_hash);
    if (!ok) return res.status(400).json({ error: 'Senha incorreta' });

    // salva apenas os dados primitivos essenciais na sessão
    req.session.user = { id: u.id, username: u.username, role: u.role };
    
    // garante que a sessão foi salva em disco antes de responder ao front-end
    req.session.save((err) => {
      if (err) {
        console.error('Erro ao salvar sessão:', err);
        return res.status(500).json({ error: 'Erro interno ao salvar sessão' });
      }
      res.json({ message: 'ok', user: req.session.user });
    });

  } catch (e) {
    console.error('Erro no Login:', e);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: 'Erro ao efetuar logout' });
    res.json({ message: 'logout' });
  });
});

app.get('/api/me', (req, res) => {
  res.json({ user: req.session.user || null });
});

//impede clientes duplicados
app.get('/api/clients', requireLogin(), async (req, res) => {
  try {
    const clients = await withDB(async (db) => await dbModule.getAllClients(db));
    res.json(clients);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/clients', requireLogin('admin'), async (req, res) => {
  try {
    const { name } = req.body;

    //validação básica de campo vazio
    if (!name || String(name).trim() === "") {
      return res.status(400).json({ error: 'O nome do cliente é obrigatório.' });
    }

    const cleanName = name.trim();

    const newClient = await withDB(async (db) => {
      return await dbModule.createClient(db, cleanName);
    });
    
    res.json(newClient);
  } catch (e) {
    //captura especificamente o erro de nome duplicado do SQLite
    if (e.message && e.message.includes('UNIQUE constraint failed: clients.name')) {
      return res.status(400).json({ error: 'Já existe um cliente cadastrado com este nome!' });
    }

    console.error('Erro ao cadastrar novo cliente:', e);
    res.status(500).json({ error: 'Falha interna ao salvar o cliente no banco de dados.' });
  }
});

app.delete('/api/clients/:id', requireLogin('admin'), async (req, res) => {
  try {
    const result = await withDB(async (db) => await dbModule.deleteClient(db, req.params.id));
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- CONTROLE DE PEDIDOS ---
//visualização de pedidos ativos na linha de produção
app.get('/api/orders/user', requireLogin(), async (req, res) => {
  try {
    const rows = await withDB(async (db) => {
      return await db.all(`
        SELECT o.*, c.name AS client_name 
        FROM orders o
        JOIN clients c ON c.id = o.client_id
        WHERE o.status != 'arquivado' 
        ORDER BY o.id DESC
      `);
    });
    // FIX: HTTP 204 (No Content) proíbe corpo na resposta — o JSON era silenciosamente
    // descartado pelos clientes. Retornar 200 com array vazio é semanticamente correto
    // e o frontend já trata o caso de array vazio normalmente.
    if (rows.length === 0) return res.status(200).json([]);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- ROTAS DO ARQUIVO ---
// 1. Listar pedidos arquivados
app.get('/api/orders/archived', requireLogin('admin'), async (req, res) => {
    try {
        const orders = await withDB(async (db) => await dbModule.getArchivedOrders(db));
        res.json({ orders });
    } catch (e) {
        console.error('Erro ao buscar pedidos arquivados:', e);
        res.status(500).json({ error: e.message });
    }
});

// 2. Desarquivar pedido (Restaurar)
app.post('/api/orders/:id/unarchive', requireLogin('admin'), async (req, res) => {
    try {
        await withDB(async (db) => await dbModule.unarchiveOrder(db, req.params.id));
        res.json({ success: true, message: 'Pedido desarquivado com sucesso.' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 3. Excluir permanentemente (O arquivo.js usa POST, não DELETE)
app.post('/api/orders/:id/delete', requireLogin('admin'), async (req, res) => {
    try {
        const order = await withDB(async (db) => {
            return await db.get('SELECT id, pdf_path FROM orders WHERE id = ?', req.params.id);
        });
        
        if (!order) return res.status(404).json({ error: 'Pedido não encontrado' });

        // Apaga o arquivo físico do PDF se existir
        if (order.pdf_path) {
            const fullPath = path.join(pdfDir, order.pdf_path);
            if (fs.existsSync(fullPath)) {
                try { fs.unlinkSync(fullPath); } catch (err) { console.warn(`Aviso: Falha ao apagar arquivo físico: ${fullPath}`); }
            }
        }

        // Apaga do banco de dados
        await withDB(async (db) => await dbModule.deleteOrder(db, req.params.id));
        res.json({ success: true, message: 'Pedido excluído permanentemente.' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Detalhes de um pedido específico
app.get('/api/orders/:id', requireLogin(), async (req, res) => {
  try {
    const details = await withDB(async (db) => await dbModule.getOrderDetails(db, req.params.id));
    res.json(details);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Criar pedido associado a um Cliente (Gera caixa 1 automaticamente)
app.post('/api/clients/:clientId/orders', requireLogin('admin'), async (req, res) => {
  const { clientId } = req.params;
  const { description, total_qty, start_date, due_date, status, firstBox } = req.body;

  try {
    const result = await withDB(async (db) => {
      // O dbModule.createOrder cuida de tudo: datas, número sequencial e criação da primeira caixa
      return await dbModule.createOrder(
        db, 
        clientId, 
        { description, total_qty, start_date, due_date, status }, 
        firstBox
      );
    });
    res.json(result);
  } catch (e) {
    console.error('Erro ao criar pedido:', e);
    res.status(500).json({ error: 'Falha interna ao processar criação do pedido.' });
  }
});

// Atualização de progresso físico realizada por operadores (Workers)
app.post('/api/orders/:id/add', requireLogin(), async (req, res) => {
  try {
    const orderId = req.params.id;
    const { qty_added } = req.body;

    if (typeof qty_added !== 'number' || qty_added <= 0) {
      return res.status(400).json({ error: 'Quantidade informada inválida.' });
    }

    await withDB(async (db) => {
      const order = await db.get('SELECT * FROM orders WHERE id=?', orderId);
      if (!order) throw new Error('Pedido não encontrado');

      const new_qty = order.current_qty + qty_added;
      if (new_qty > order.total_qty) {
        throw new Error(`Quantidade excede o limite estipulado. Máx: ${order.total_qty}. Atual: ${order.current_qty}.`);
      }

      await db.run('UPDATE orders SET current_qty=? WHERE id=?', new_qty, orderId);
      await db.run('INSERT INTO progress_log (order_id, user_id, qty_added, timestamp) VALUES (?, ?, ?, ?)',
        orderId, req.session.user.id, qty_added, new Date().toISOString()
      );
    });

    res.json({ message: 'Progresso atualizado com sucesso' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Mudar status para Finalizado
app.post('/api/orders/:id/finalize', requireLogin('admin'), async (req, res) => {
  try {
    const updated = await withDB(async (db) => await dbModule.updateOrderStatus(db, req.params.id, 'finalizado'));
    res.json({ message: 'Pedido finalizado com sucesso', order: updated });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Arquivar Pedido (Exige que o PDF tenha sido emitido antes)
app.post('/api/orders/:id/archive', requireLogin('admin'), async (req, res) => {
    try {
        await withDB(async (db) => {
            const order = await db.get(`SELECT pdf_path FROM orders WHERE id=?`, req.params.id);
            if (!order || !order.pdf_path) {
                throw new Error("Não é possível arquivar: O PDF do relatório final deve ser gerado antes.");
            }
            // FIX: Agora salva a data exata do arquivamento na nova coluna
            await db.run(
                `UPDATE orders SET status = 'arquivado', archived_at = datetime('now') WHERE id = ?`, 
                req.params.id
            );
        });
        res.json({ success: true, message: 'Pedido arquivado com sucesso!' });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// Deletar pedido e seu arquivo PDF físico correspondente
app.delete('/api/orders/:id', requireLogin('admin'), async (req, res) => {
  try {
    const order = await withDB(async (db) => {
      return await db.get('SELECT id, pdf_path FROM orders WHERE id = ?', req.params.id);
    });

    if (!order) return res.status(404).json({ error: 'Pedido não encontrado' });

    if (order.pdf_path) {
      const fullPath = path.join(pdfDir, order.pdf_path);
      if (fs.existsSync(fullPath)) {
        try { fs.unlinkSync(fullPath); } catch (err) { console.warn(`Aviso: Falha ao apagar arquivo físico: ${fullPath}`); }
      }
    }

    await withDB(async (db) => await dbModule.deleteOrder(db, req.params.id));
    res.json({ success: true, message: 'Pedido e arquivos associados excluídos com sucesso' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- CONTROLE DAS CAIXAS ---

app.post('/api/orders/:orderId/boxes', requireLogin('admin'), async (req, res) => {
  try {
    const { productId, productQty } = req.body;
    const newBox = await withDB(async (db) => {
      return await dbModule.addBoxToOrder(db, req.params.orderId, productId, productQty);
    });
    res.json(newBox);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/boxes/:boxId', requireLogin('admin'), async (req, res) => {
  try {
    const { productId, productQty } = req.body;
    const updatedBox = await withDB(async (db) => {
      return await dbModule.updateBox(db, req.params.boxId, productId, productQty);
    });
    res.json(updatedBox);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/orders/:orderId/boxes/:boxId', requireLogin('admin'), async (req, res) => {
  try {
    const result = await withDB(async (db) => {
      return await dbModule.removeBoxFromOrder(db, req.params.orderId, req.params.boxId);
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- ROTAS DE PRODUTOS ---

app.get('/api/products', requireLogin(), async (req, res) => {
  try {
    const products = await withDB(async (db) => await dbModule.getAllProducts(db));
    res.json(products);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/products', requireLogin('admin'), async (req, res) => {
  try {
    const newProd = await withDB(async (db) => await dbModule.createProduct(db, req.body));
    res.json(newProd);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

//  Rota: Excluir Produto do banco de dados
app.delete('/api/products/:id', requireLogin('admin'), async (req, res) => {
  try {
    const result = await withDB(async (db) => await dbModule.deleteProduct(db, req.params.id));
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// --- GERAÇÃO DE PDF ---

app.post('/api/orders/:id/generate-pdf', requireLogin('admin'), async (req, res) => {
  try {
    const orderId = req.params.id;
    const orderDetails = await withDB(async (db) => await dbModule.getOrderDetails(db, orderId));

    // Determina e garante a pasta do mês (ex: Public/pdfs/2026-maio)
    const pastaMes = obterPastaMesAtual();
    const pdfDirMes = path.join(pdfDir, pastaMes);
    if (!fs.existsSync(pdfDirMes)) {
      fs.mkdirSync(pdfDirMes, { recursive: true });
    }

    const pdfFileName = `relatorio_pedido_${orderId}_${Date.now()}.pdf`;
    const fullPdfPath = path.join(pdfDirMes, pdfFileName);

    const doc = new PDFDocument({ margin: 50 });
    const writeStream = fs.createWriteStream(fullPdfPath);
    doc.pipe(writeStream);

    // --- Renderização de Textos ---
    doc.fontSize(20).text('RELATÓRIO DE IMPRESSÃO DO PEDIDO', { align: 'center', underline: true });
    doc.moveDown(2);

    doc.fontSize(12).font('Helvetica-Bold').text(`Cliente: `, { continued: true }).font('Helvetica').text(orderDetails.client_name);
    doc.font('Helvetica-Bold').text(`Número do Pedido (Cliente): `, { continued: true }).font('Helvetica').text(String(orderDetails.client_order_number));
    doc.font('Helvetica-Bold').text(`Descrição: `, { continued: true }).font('Helvetica').text(orderDetails.description || 'Nenhuma');
    doc.font('Helvetica-Bold').text(`Status Atual: `, { continued: true }).font('Helvetica').text(orderDetails.status.toUpperCase());
    doc.font('Helvetica-Bold').text(`Data de Abertura: `, { continued: true }).font('Helvetica').text(orderDetails.order_date || '-');
    doc.font('Helvetica-Bold').text(`Data de Entrega: `, { continued: true }).font('Helvetica').text(orderDetails.due_date || '-');
    doc.moveDown(1);
    
    doc.font('Helvetica-Bold').text(`Quantidade Total do Pedido: `, { continued: true }).font('Helvetica').text(`${orderDetails.total_qty} unidades`);
    doc.font('Helvetica-Bold').text(`Total de Caixas Cadastradas: `, { continued: true }).font('Helvetica').text(`${orderDetails.boxes.length}`);
    
    doc.moveDown(2);
    doc.fontSize(14).font('Helvetica-Bold').text('Detalhamento de Distribuição por Caixas:', { underline: true });
    doc.moveDown(1);

    let pesoTotalGrams = 0;

    orderDetails.boxes.forEach((box) => {
      const pesoCaixaGrams = (box.product_qty || 0) * (box.weight_grams || 0);
      pesoTotalGrams += pesoCaixaGrams;

      doc.fontSize(11).font('Helvetica-Bold').text(`Caixa N° ${box.box_number}`);
      doc.font('Helvetica')
         .text(`  • Produto: ${box.product_code || 'Não Definido'} - ${box.product_description || 'Sem descrição'}`)
         .text(`  • Qtd de Itens nesta Caixa: ${box.product_qty} un`)
         .text(`  • Peso Unitário do Item: ${box.weight_grams || 0} g`)
         .text(`  • Peso Líquido Total da Caixa: ${pesoCaixaGrams} g Imbalado (${(pesoCaixaGrams / 1000).toFixed(2)} kg)`);
      doc.moveDown(0.5);
    });

    doc.moveDown(1.5);
    doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
    doc.moveDown(1);

    doc.fontSize(13).font('Helvetica-Bold').text(`Métricas Consolidadas de Carga:`);
    doc.fontSize(11).font('Helvetica')
       .text(`  - Peso Bruto Total Calculado: ${pesoTotalGrams} g`)
       .text(`  - Peso Equivalente em Quilos: ${(pesoTotalGrams / 1000).toFixed(2)} kg`);

    doc.end();

    writeStream.on('finish', async () => {
      await withDB(async (db) => {
        // Guarda o caminho relativo completo contendo o mês no banco
        const dbPath = `${pastaMes}/${pdfFileName}`;
        await db.run(
          `UPDATE orders SET pdf_path=?, pdf_generated_at=datetime('now') WHERE id=?`,
          [dbPath, orderId]
        );
      });
      res.json({ message: 'PDF gerado com sucesso!', pdf_path: `/pdfs/${pastaMes}/${pdfFileName}` });
    });

  } catch (e) {
    console.error('Erro na criação do PDF:', e);
    res.status(500).json({ error: 'Falha interna ao estruturar arquivo de impressão.' });
  }
});

// 2. ROTA DE ATUALIZAÇÃO E REPLANEJAMENTO DE PEDIDOS (PUT)
app.put('/api/orders/:id', requireLogin('admin'), async (req, res) => {
  const orderId = req.params.id;
  const { description, total_qty, start_date, due_date, boxes } = req.body;

  try {
    await withDB(async (db) => {
      // Atualiza os metadados e parâmetros da ordem principal
      await db.run(
        `UPDATE orders SET description = ?, total_qty = ?, start_date = ?, due_date = ? WHERE id = ?`,
        [description, total_qty, start_date, due_date, orderId]
      );

      // Se o payload contiver o mapeamento reestruturado de caixas
      if (boxes && Array.isArray(boxes)) {
        // Limpa a distribuição antiga das caixas vinculadas
        await db.run('DELETE FROM boxes WHERE order_id = ?', [orderId]);

        // Remonta e insere a nova sequência sequencial de caixas
        let currentBoxNum = 1;
        for (let box of boxes) {
          await db.run(
            `INSERT INTO boxes (order_id, box_number, product_id, product_qty) VALUES (?, ?, ?, ?)`,
            [orderId, currentBoxNum, box.product_id, box.product_qty]
          );
          currentBoxNum++;
        }
      }
    });
    res.json({ success: true, message: 'Pedido e distribuição atualizados perfeitamente.' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erro no servidor durante o processamento do lote.' });
  }
});

//--- ENDPOINT DE ETIQUETAS COM CÓDIGO DE BARRAS ---
app.post('/api/orders/:id/generate-labels', requireLogin('admin'), async (req, res) => {
  try {
    const orderId = req.params.id;
    const orderDetails = await withDB(async (db) => await dbModule.getOrderDetails(db, orderId));
    
    if (!orderDetails.boxes || orderDetails.boxes.length === 0) {
      return res.status(400).json({ error: 'Este pedido não possui caixas cadastradas para gerar etiquetas.' });
    }

    // Determina e garante a pasta do mês (ex: Public/pdfs/2026-maio)
    const pastaMes = obterPastaMesAtual();
    const pdfDirMes = path.join(pdfDir, pastaMes);
    if (!fs.existsSync(pdfDirMes)) {
      fs.mkdirSync(pdfDirMes, { recursive: true });
    }

    const pdfFileName = `etiquetas_pedido_${orderId}_${Date.now()}.pdf`;
    const fullPdfPath = path.join(pdfDirMes, pdfFileName);

    const doc = new PDFDocument({ size: 'A4', margin: 30 });
    const writeStream = fs.createWriteStream(fullPdfPath);
    doc.pipe(writeStream);

    doc.fontSize(16).font('Helvetica-Bold').text(`ETIQUETAS DE EXPEDIÇÃO - PEDIDO N° ${orderId}`, { align: 'center' });
    
    const totalBoxes = orderDetails.boxes.length;

    const generateBarcodeBuffer = (text) => {
      return bwipjs.toBuffer({
        bcid: 'code128',       // Formato estrito Code 128
        text: text,            
        scale: 3,              
        height: 12,            
        includetext: true,     
        textxalign: 'center',
      });
    };

    const itemsPerPage = 4;    
    const cardHeight = 150;    
    const startY = 70;         

    for (let i = 0; i < orderDetails.boxes.length; i++) {
      const box = orderDetails.boxes[i];
      const pageIdx = i % itemsPerPage;

      if (i > 0 && pageIdx === 0) {
        doc.addPage();
      }

      const currentTop = startY + (pageIdx * cardHeight);

      // Higienização completa contra hífens acidentais
      const clientClean = orderDetails.client_name.replace(/-/g, '').replace(/\s+/g, ' ').toUpperCase().trim();
      const prodClean = (box.product_code || 'SR').replace(/-/g, '').replace(/\s+/g, '').toUpperCase().trim();
      // Formato único por caixa: CLT[clientId]-ORD[orderId]-CX[boxNumber]-QTY[qty]
      // Garante que cada caixa de cada pedido de cada cliente tenha um barcode absolutamente exclusivo:
      //   • CLT identifica o cliente (sem colisão entre clientes diferentes)
      //   • ORD identifica o pedido pelo ID do banco (sem colisão entre pedidos)
      //   • CX  identifica o número da caixa dentro do pedido (sem colisão entre caixas do mesmo pedido)
      //   • QTY carrega a quantidade embalada (informação de conferência)
      const barcodeText = `CLT${orderDetails.client_id}-ORD${orderId}-CX${box.box_number}-QTY${box.product_qty}`;

      try {
        const barcodeBuffer = await generateBarcodeBuffer(barcodeText);

        doc.rect(50, currentTop, 495, 130).lineWidth(1).stroke('#cccccc');
        doc.fillColor('#000000');
        doc.fontSize(10);
        
        doc.font('Helvetica-Bold').text(`CLIENTE: `, 65, currentTop + 15, { continued: true })
           .font('Helvetica').text(clientClean);
           
        doc.font('Helvetica-Bold').text(`PEDIDO CLIENTE: `, 65, currentTop + 35, { continued: true })
           .font('Helvetica').text(String(orderDetails.client_order_number));
           
        doc.font('Helvetica-Bold').text(`CAIXA REGISTRADA: `, 65, currentTop + 55, { continued: true })
           .font('Helvetica').text(`${box.box_number} de ${totalBoxes}`);
           
        doc.font('Helvetica-Bold').text(`PRODUTO: `, 65, currentTop + 75, { continued: true })
           .font('Helvetica').text(`${prodClean} (${box.product_description || 'Sem descrição'})`);
           
        doc.font('Helvetica-Bold').text(`QTD EMBALADA: `, 65, currentTop + 95, { continued: true })
           .font('Helvetica').text(`${box.product_qty} un`);

        doc.image(barcodeBuffer, 345, currentTop + 25, { width: 185, height: 80 });

      } catch (err) {
        console.error(`Falha ao renderizar barra da caixa ${box.box_number}:`, err);
      }
    }

    doc.end();

    writeStream.on('finish', () => {
      res.json({ message: 'Etiquetas geradas com sucesso!', pdf_path: `/pdfs/${pastaMes}/${pdfFileName}` });
    });

  } catch (e) {
    console.error('Erro na rota de etiquetas:', e);
    res.status(500).json({ error: 'Erro interno ao processar folhas de etiquetas.' });
  }
});

// --- SERVIÇOS DE REDE LOCAL E INICIALIZAÇÃO --- 

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (let name in interfaces) {
    for (let iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

app.get('/favicon.ico', (req, res) => {
  const favPath = path.join(process.cwd(), 'Public', 'favicon.ico');
  if (fs.existsSync(favPath)) {
    res.sendFile(favPath);
  } else {
    res.status(204).end();
  }
});

// --- LEITOR DE CÓDIGO DE BARRAS ---
app.post('/api/shipping/dispatch', requireLogin('admin'), async (req, res) => {
  const { barcode } = req.body;
  if (!barcode) {
    return res.status(400).json({ error: 'Nenhum código de barras foi lido.' });
  }

  try {
    // Novo formato de barcode: CLT[clientId]-ORD[orderId]-CX[boxNumber]-QTY[qty]
    // Cada segmento identifica unicamente um nível da hierarquia:
    //   CLT → cliente (evita colisão entre clientes diferentes)
    //   ORD → pedido pelo ID do banco (evita colisão entre pedidos)
    //   CX  → número da caixa dentro do pedido (evita colisão entre caixas do mesmo pedido)
    //   QTY → quantidade embalada (informação de conferência, não usada para lookup)
    // A combinação ORD+CX já é suficiente para identificar uma única caixa no banco,
    // mas CLT é validado como camada extra de segurança contra bipes cruzados.
    const barcodeMatch = barcode.match(/CLT(\d+)-ORD(\d+)-CX(\d+)-QTY(\d+)/);
    if (!barcodeMatch) {
      return res.status(400).json({ error: 'Formato de código de barras inválido. Esperado: CLT[clientId]-ORD[orderId]-CX[caixa]-QTY[qtd]' });
    }

    const clientId  = parseInt(barcodeMatch[1], 10);
    const orderId   = parseInt(barcodeMatch[2], 10);
    const boxNumber = parseInt(barcodeMatch[3], 10);
    // productQty (grupo 4) não é usado para lookup — a busca é feita por orderId+boxNumber,
    // que é única por constraint do banco (UNIQUE(order_id, box_number)).

    const result = await withDB(async (db) => {
      // Busca a caixa pelo orderId + boxNumber: lookup 100% unambíguo.
      // Valida também o clientId para detectar bipes cruzados entre clientes.
      const boxData = await db.get(`
        SELECT
          b.id AS box_id, b.product_qty, b.box_number, b.order_id,
          o.client_order_number, o.client_id, o.status AS order_status,
          p.code AS product_code, p.description AS product_description,
          c.name AS client_name,
          (SELECT COUNT(*) FROM boxes WHERE order_id = b.order_id) AS total_boxes
        FROM boxes b
        JOIN orders o ON b.order_id = o.id
        LEFT JOIN products p ON b.product_id = p.id
        JOIN clients c ON o.client_id = c.id
        WHERE b.order_id = ? AND b.box_number = ? AND o.client_id = ?
      `, orderId, boxNumber, clientId);

      if (!boxData) {
        return { error: `Caixa #${boxNumber} não encontrada no pedido #${orderId} para este cliente. Verifique se a etiqueta pertence a este pedido.` };
      }
      return { success: true, data: boxData };
    });

    if (result.error) {
      return res.status(404).json({ error: result.error });
    }

    res.json({
      client_name:          result.data.client_name,
      client_order_number:  result.data.client_order_number,
      order_id:             result.data.order_id,
      product_code:         result.data.product_code || 'N/A',
      product_description:  result.data.product_description || '',
      product_qty:          result.data.product_qty,
      total_boxes:          result.data.total_boxes   // quantas caixas existem no pedido (para o frontend calcular progresso)
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno no servidor ao processar expedição.' });
  }
});

// Inicialização do Servidor Express vinculando a interface '0.0.0.0' (Acesso externo liberado)
app.listen(PORT, '0.0.0.0', () => {
  const localIP = getLocalIP();
  
  // Executa a criação automatizada do atalho no desktop do usuário Windows
  criarAtalhoNoDesktop(pdfDir);

  console.log(`------------------------------------------------------------`);
  console.log(` SERVIDOR ATIVO`);
  console.log(` Para acesso na Máquina Local:  http://localhost:${PORT}`);
  console.log(` Para acesso para outros dispositivos: http://${localIP}:${PORT}`);
  console.log(` Pasta de PDFs: ${pdfDir}`);
  console.log(`------------------------------------------------------------`);
});