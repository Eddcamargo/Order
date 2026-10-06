// --- dependencias ---

const { open } = require('sqlite');
const sqlite3 = require('sqlite3');
const bcrypt = require('bcrypt');

// --- inicialização de database ---
async function getDb() {
  const db = await open({
    filename: './database.db',
    driver: sqlite3.Database
  });

  // habilita foreign key
  await db.exec(`PRAGMA foreign_keys = ON`);

  // USERS
  // Salva logins
  await db.exec(`CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    UNIQUE NOT NULL,
    password_hash TEXT    NOT NULL,
    role          TEXT    CHECK(role IN ('admin','user')) NOT NULL
  )`);

  // CLIENTES -- semi-estaticos. Criados pelo admin, raramente deletados. Deleção protegida por senha no nível da rota/API (não aqui).
  await db.exec(`CREATE TABLE IF NOT EXISTS clients (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    UNIQUE NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  )`);

  // ORDERS(pedidos) -- objetos, pertencem a clientes, deletadas se o cliente for deletado  
  await db.exec(`CREATE TABLE IF NOT EXISTS orders (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id           INTEGER NOT NULL,
    client_order_number INTEGER NOT NULL,
    description         TEXT,
    total_qty           INTEGER NOT NULL DEFAULT 0,
    current_qty         INTEGER NOT NULL DEFAULT 0,
    start_date          TEXT,
    due_date            TEXT,
    order_date          TEXT,
    status              TEXT    DEFAULT 'pendente',
    pdf_path            TEXT    DEFAULT NULL,
    pdf_generated_at    TEXT    DEFAULT NULL,
    FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE CASCADE,
    UNIQUE(client_id, client_order_number)
  )`);

  // Exibe quando o pedido foi arquivado. NULL se não arquivado.
  try {
      await db.exec(`ALTER TABLE orders ADD COLUMN archived_at TEXT`);
  } catch (e) {
  }

  // Produtos, semi-estaticos, raramente deletados. Deleção protegida por senha no nível da rota/API (não aqui).
  await db.exec(`CREATE TABLE IF NOT EXISTS products (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    code          TEXT    UNIQUE NOT NULL,
    description   TEXT,
    weight_grams  INTEGER NOT NULL   -- required, no default
  )`);

  // --- Caixas, pertencem a pedidos, deletadas se o pedido for deletado. Cada caixa tem um número único dentro do pedido (Box 1, Box 2, etc).
  await db.exec(`CREATE TABLE IF NOT EXISTS boxes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id    INTEGER NOT NULL,
    box_number  INTEGER NOT NULL,
    product_id  INTEGER DEFAULT NULL,
    product_qty INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY(order_id)   REFERENCES orders(id)   ON DELETE CASCADE,
    FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE SET NULL,
    UNIQUE(order_id, box_number)
  )`);

  // ---PROGRESS LOG(auto explicativo)---
  await db.exec(`CREATE TABLE IF NOT EXISTS progress_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id      INTEGER NOT NULL,
    user_id       INTEGER NOT NULL,
    qty_added     INTEGER NOT NULL,
    timestamp     TEXT    NOT NULL,
    order_details TEXT,
    FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id)  REFERENCES users(id)  ON DELETE CASCADE
  )`);

  // --- Mapeamento de códigos de prefixo ---
  await db.exec(`CREATE TABLE IF NOT EXISTS code_prefix_map (
    prefix               TEXT PRIMARY KEY,
    friendly_description TEXT
  )`);

  // SEED DATA
  // Default users only. These only insert if the row doesn't already exist.
  // Default admin user
  const adminExists = await db.get(`SELECT id FROM users WHERE username='admin'`);
  if (!adminExists) {
    const hash = await bcrypt.hash('admin123', 10);
    await db.run(
      `INSERT INTO users (username, password_hash, role) VALUES (?,?,?)`,
      'admin', hash, 'admin'
    );
  }

  // Default worker user
  const workerExists = await db.get(`SELECT id FROM users WHERE username='worker'`);
  if (!workerExists) {
    const hash = await bcrypt.hash('worker123', 10);
    await db.run(
      `INSERT INTO users (username, password_hash, role) VALUES (?,?,?)`,
      'worker', hash, 'user'
    );
  }

  return db;
}

// --- Funções de clientes --- 

/**
 * getAllClients
 * @param {object} db 
 * @returns {Array} 
 */
async function getAllClients(db) {
  return await db.all(`
    SELECT c.*, COUNT(o.id) AS order_count
    FROM clients c
    LEFT JOIN orders o ON o.client_id = c.id
    GROUP BY c.id
    ORDER BY c.name ASC
  `);
}

/**
 * createClient
 * Nome precisa ser unico.
 * @param {object} db
 * @param {string} name 
 * @returns {object} 
 * @throws 
 */
async function createClient(db, name) {
  if (!name || name.trim() === '') {
    throw new Error('O nome do cliente é obrigatório.');
  }

  const result = await db.run(
    `INSERT INTO clients (name) VALUES (?)`,
    name.trim()
  );

  return await db.get(`SELECT * FROM clients WHERE id=?`, result.lastID);
}

/**
 * deleteClient
 * @param {object} db
 * @param {number} clientId
 * @returns {object}
 * @throws 
 */
async function deleteClient(db, clientId) {
  const client = await db.get(`SELECT * FROM clients WHERE id=?`, clientId);
  if (!client) throw new Error('Cliente não encontrado.');

  await db.run(`DELETE FROM clients WHERE id=?`, clientId);
  return { deleted: true, client };
}

// --- Funções de pedidos ---

/**
 * getClientOrders
 * @param {object} db
 * @param {number} clientId
 * @returns {Array} - inclue client_name and total_box_qty 
 */
async function getClientOrders(db, clientId) {
  return await db.all(`
    SELECT
      o.*,
      c.name AS client_name,
      (SELECT SUM(b.product_qty) FROM boxes b WHERE b.order_id = o.id) AS total_box_qty
    FROM orders o
    JOIN clients c ON c.id = o.client_id
    WHERE o.client_id = ?
    ORDER BY o.client_order_number ASC
  `, clientId);
}

/**
 * getOrderDetails
 * @param {object} db
 * @param {number} orderId
 * @returns {object} 
 * @throws 
 */
async function getOrderDetails(db, orderId) {
  const order = await db.get(`
    SELECT o.*, c.name AS client_name
    FROM orders o
    JOIN clients c ON c.id = o.client_id
    WHERE o.id = ?
  `, orderId);

  if (!order) throw new Error('Pedido não encontrado.');

  const boxes = await db.all(`
    SELECT
      b.*,
      p.code          AS product_code,
      p.description   AS product_description,
      p.weight_grams
    FROM boxes b
    LEFT JOIN products p ON p.id = b.product_id
    WHERE b.order_id = ?
    ORDER BY b.box_number ASC
  `, orderId);

  const totalBoxQty = boxes.reduce((sum, box) => sum + (box.product_qty || 0), 0);

  return {
    ...order,
    boxes,
    total_box_qty:  totalBoxQty,
    qty_remaining:  order.total_qty - totalBoxQty   // how many products still unassigned to boxes
  };
}

/**
 * _getNextClientOrderNumber (parametrização)
 * @param {object} db
 * @param {number} clientId
 * @returns {number} - Numero do proximo pedido
 */
async function _getNextClientOrderNumber(db, clientId) {
  const row = await db.get(
    `SELECT MAX(client_order_number) AS max_num FROM orders WHERE client_id=?`,
    clientId
  );
  return (row.max_num || 0) + 1;
}

/**
 * createOrder
 * @param {object} db
 * @param {number} clientId 
 * @param {object} orderData 
 *   - Order fields:
 *   - description   {string}
 *   - total_qty     {number} 
 *   - start_date    {string} 'YYYY-MM-DD'
 *   - due_date      {string} 'YYYY-MM-DD'
 *   - order_date    {string} 'YYYY-MM-DD' (default é a data atual)
 *   - status        {string} (default é 'pendente')
 * @param {object} firstBox - First box setup:
 *   - product_id    {number|null} identifador do produto (null pra poder criar a caixa sem produto)
 *   - product_qty   {number}      quantos produtos? (pode ser 0)
 * @returns {object} - cria ordem e suas caixas
 * @throws - Se o cliente não for encontrado
 */
async function createOrder(db, clientId, orderData, firstBox = {}) {
  const client = await db.get(`SELECT * FROM clients WHERE id=?`, clientId);
  if (!client) throw new Error('Cliente não encontrado.');

  const orderNumber = await _getNextClientOrderNumber(db, clientId);

  const result = await db.run(`
    INSERT INTO orders
      (client_id, client_order_number, description, total_qty, current_qty,
       start_date, due_date, order_date, status)
    VALUES (?,?,?,?,?,?,?,?,?)`,
    clientId,
    orderNumber,
    orderData.description  || '',
    orderData.total_qty    || 0,
    0,                                                           // current_qty sempre começa em 0
    orderData.start_date   || null,
    orderData.due_date     || null,
    orderData.order_date   || new Date().toISOString().slice(0, 10),
    orderData.status       || 'pendente'
  );

  const orderId = result.lastID;

  //Cria uma caixa inicial para o pedido, mesmo que não tenha produto atribuído ainda.
  await db.run(
    `INSERT INTO boxes (order_id, box_number, product_id, product_qty) VALUES (?,?,?,?)`,
    orderId,
    1,
    firstBox.product_id  ?? null,
    firstBox.product_qty ?? 0
  );

  return await getOrderDetails(db, orderId);
}

/**
 * deleteOrder
 * @param {object} db
 * @param {number} orderId
 * @returns {object} 
 * @throws se nao encontrada
 */
async function deleteOrder(db, orderId) {
  const order = await db.get(`SELECT * FROM orders WHERE id=?`, orderId);
  if (!order) throw new Error('Pedido não encontrado.');

  await db.run(`DELETE FROM orders WHERE id=?`, orderId);
  return { deleted: true, order };
}

/**
 * updateOrderStatus
 * @param {object} db
 * @param {number} orderId
 * @param {string} status
 * @returns {object} 
 */
async function updateOrderStatus(db, orderId, status) {
  const order = await db.get(`SELECT * FROM orders WHERE id=?`, orderId);
  if (!order) throw new Error('Pedido não encontrado.');

  await db.run(`UPDATE orders SET status=? WHERE id=?`, status, orderId);
  return await db.get(`SELECT * FROM orders WHERE id=?`, orderId);
}

// --- Funções de produtos ---
/**
 * getAllProducts
 * @param {object} db
 * @returns {Array} - All products
 */
async function getAllProducts(db) {
  return await db.all(`SELECT * FROM products ORDER BY code ASC`);
}

/**
 * createProduct
 * @param {object} db
 * @param {object} productData
 *   - code          {string} codigo do produto (obrigatório, deve ser único)
 *   - description   {string}  descrição do produto (opcional)
 *   - weight_grams  {number}  peso em gramas (obrigatório, deve ser > 0)
 * @returns {object} 
 * @throws se o código do produto for vazio ou se o peso for inválido
 */
async function createProduct(db, productData) {
  if (!productData.code || productData.code.trim() === '') {
    throw new Error('O código do produto é obrigatório.');
  }
  if (!productData.weight_grams || productData.weight_grams <= 0) {
    throw new Error('O peso em gramas é obrigatório e deve ser maior que zero.');
  }

  const result = await db.run(
    `INSERT INTO products (code, description, weight_grams) VALUES (?,?,?)`,
    productData.code.trim(),
    productData.description || '',
    productData.weight_grams
  );

  return await db.get(`SELECT * FROM products WHERE id=?`, result.lastID);
}

/**
 * deleteProduct
 * @param {object} db
 * @param {number} productId
 * @returns {object} 
 * @throws se nao encontrado
 */
async function deleteProduct(db, productId) {
  const product = await db.get(`SELECT * FROM products WHERE id=?`, productId);
  if (!product) throw new Error('Produto não encontrado.');

  await db.run(`DELETE FROM products WHERE id=?`, productId);
  return { deleted: true, product };
}


// --- Funções de caixas ---
/**
 * addBoxToOrder
 * @param {object} db
 * @param {number} orderId
 * @param {number|null} productId   - produtos que vao para a caixa (pode ser nulo)
 * @param {number}      productQty  - quantos produtos vao para a caixa (pode ser 0)
 * @returns {object} 
 * @throws se o pedido não for encontrado
 */
async function addBoxToOrder(db, orderId, productId, productQty) {
  const order = await db.get(`SELECT * FROM orders WHERE id=?`, orderId);
  if (!order) throw new Error('Pedido não encontrado.');

  // encontra o maior numero de caixa existente para este pedido e incrementa para a nova caixa
  const row = await db.get(
    `SELECT MAX(box_number) AS max_num FROM boxes WHERE order_id=?`,
    orderId
  );
  const nextBoxNumber = (row.max_num || 0) + 1;

  const result = await db.run(
    `INSERT INTO boxes (order_id, box_number, product_id, product_qty) VALUES (?,?,?,?)`,
    orderId, nextBoxNumber, productId ?? null, productQty ?? 0
  );

  // Devolve a caixa recém-criada com os detalhes do produto (se houver)
  return await db.get(`
    SELECT b.*, p.code AS product_code, p.description AS product_description, p.weight_grams
    FROM boxes b
    LEFT JOIN products p ON p.id = b.product_id
    WHERE b.id=?
  `, result.lastID);
}

/**
 * updateBox
 * @param {object} db
 * @param {number}      boxId
 * @param {number|null} productId   - id de novo produto (ou nulo se nao precisar)
 * @param {number}      productQty  - nova quantidade de caixas
 * @returns {object} - atualiza row de caixas (com detalhes)
 * @throws se nao encontrada
 */
async function updateBox(db, boxId, productId, productQty) {
  const box = await db.get(`SELECT * FROM boxes WHERE id=?`, boxId);
  if (!box) throw new Error('Caixa não encontrada.');

  await db.run(
    `UPDATE boxes SET product_id=?, product_qty=? WHERE id=?`,
    productId ?? null, productQty, boxId
  );

  return await db.get(`
    SELECT b.*, p.code AS product_code, p.description AS product_description, p.weight_grams
    FROM boxes b
    LEFT JOIN products p ON p.id = b.product_id
    WHERE b.id=?
  `, boxId);
}

/**
 * removeBoxFromOrder
 * @param {object} db
 * @param {number} orderId 
 * @param {number} boxId   
 * @returns {object} 
 * @throws se a caixa não for encontrada, se ela pertencer a um pedido diferente ou se for a última caixa
 */
async function removeBoxFromOrder(db, orderId, boxId) {
  const boxCount = await db.get(
    `SELECT COUNT(*) AS cnt FROM boxes WHERE order_id=?`,
    orderId
  );
  if (boxCount.cnt <= 1) {
    throw new Error('Não é possível remover a última caixa. Um pedido deve ter pelo menos uma caixa.');
  }

  const box = await db.get(
    `SELECT * FROM boxes WHERE id=? AND order_id=?`,
    boxId, orderId
  );
  if (!box) throw new Error('Caixa não encontrada neste pedido.');

  await db.run(`DELETE FROM boxes WHERE id=?`, boxId);
  return { deleted: true, box };
}

/**
 * getBoxesTotalQty
 * @param {object} db
 * @param {number} orderId
 * @returns {number} - soma de quantidade de produtos em todas as caixas do pedido
 */
async function getBoxesTotalQty(db, orderId) {
  const row = await db.get(
    `SELECT SUM(product_qty) AS total FROM boxes WHERE order_id=?`,
    orderId
  );
  return row.total || 0;
}

// ---Funções de arquivamento de pedidos---
async function getArchivedOrders(db) {
    return await db.all(`
        SELECT 
            o.id AS order_id,
            c.name AS client_name,
            o.client_order_number,
            o.archived_at,
            o.archived_at AS archived_at_iso,
            o.pdf_generated_at AS dispatched_at,
            (SELECT COUNT(*) FROM boxes b WHERE b.order_id = o.id) AS box_count
        FROM orders o
        JOIN clients c ON o.client_id = c.id
        WHERE o.status = 'arquivado'
        ORDER BY o.archived_at DESC
    `);
}

/**
 * unarchiveOrder
 * Restaura um pedido arquivado para o status 'pendente'.
 */
async function unarchiveOrder(db, orderId) {
    const order = await db.get(`SELECT * FROM orders WHERE id=?`, orderId);
    if (!order) throw new Error('Pedido não encontrado.');
    
    await db.run(`UPDATE orders SET status = 'pendente', archived_at = NULL WHERE id = ?`, orderId);
    return { success: true };
}

// EXPORTS
module.exports = {
  // Core DB initialization
  getDb,

  // Clientes
  getAllClients,
  createClient,
  deleteClient,

  // Pedidos
  getClientOrders,
  getOrderDetails,
  createOrder,
  deleteOrder,
  updateOrderStatus,

  // Produtos 
  getAllProducts,
  createProduct,
  deleteProduct,

  // Caixas 
  addBoxToOrder,
  updateBox,
  removeBoxFromOrder,
  getBoxesTotalQty,

  // Funções de arquivamento
  getArchivedOrders,
  unarchiveOrder,
};
