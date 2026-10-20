// Database layer: creates the SQLite tables and seeds demo data on first run.
const { DatabaseSync } = require("node:sqlite"); // built into Node 22.5+, nothing to compile
const bcrypt = require("bcryptjs");
const path = require("path");

const db = new DatabaseSync(path.join(__dirname, "trackly.db"));
db.exec("PRAGMA journal_mode = WAL;");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','boy')),
  area TEXT
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  address TEXT NOT NULL,
  landmark TEXT,
  pincode TEXT NOT NULL,
  pickup TEXT,
  area TEXT NOT NULL,
  item TEXT NOT NULL,
  boy_id INTEGER REFERENCES users(id),
  status INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS order_history (
  order_id INTEGER NOT NULL REFERENCES orders(id),
  status INTEGER NOT NULL,
  at TEXT NOT NULL,
  UNIQUE (order_id, status)
);
`);

if (db.prepare("SELECT COUNT(*) AS c FROM users").get().c === 0) {
  const addUser = db.prepare("INSERT INTO users (name, phone, password_hash, role, area) VALUES (?,?,?,?,?)");
  addUser.run("Admin", "9999999999", bcrypt.hashSync("admin123", 10), "admin", null);
  const boyIds = [
    ["Ravi K.", "9848011111", "Madhapur"],
    ["Anita S.", "9849022222", "Kukatpally"],
    ["Imran A.", "9989033333", "Secunderabad"],
  ].map(([n, p, a]) => addUser.run(n, p, bcrypt.hashSync("boy123", 10), "boy", a).lastInsertRowid);

  const addOrder = db.prepare(`INSERT INTO orders
    (customer_name, customer_phone, address, landmark, pincode, pickup, area, item, boy_id, status)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);
  const setCode = db.prepare("UPDATE orders SET code = ? WHERE id = ?");
  const addHist = db.prepare("INSERT INTO order_history (order_id, status, at) VALUES (?,?,?)");
  const samples = [
    ["Sneha Reddy", "9876501234", "Plot 12, Road 3", "Near City Centre Mall", "500034", "Croma Store, Banjara Hills", "Banjara Hills", "Wireless headphones", boyIds[0], 2],
    ["Arjun Rao", "9876505678", "Flat 4B, Sai Heights", "Opp. KPHB Metro", "500072", "Footwear Hub, KPHB", "Kukatpally", "Running shoes", boyIds[1], 3],
    ["Fatima Khan", "9876509012", "House 8-2-5", "Behind Clock Tower", "500003", "Book Corner, Secunderabad", "Secunderabad", "Books (3)", boyIds[2], 4],
  ];
  for (const s of samples) {
    const id = addOrder.run(...s).lastInsertRowid;
    setCode.run("TRK" + (1000 + Number(id)), id);
    for (let st = 0; st <= s[9]; st++) addHist.run(id, st, new Date(Date.now() - (s[9] - st) * 45 * 60000).toISOString());
  }
}

module.exports = db;
