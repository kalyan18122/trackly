// Trackly backend: Express REST API only (the front end runs separately).
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("./db");

const SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const PORT = process.env.PORT || 3000;
const LAST_STAGE = 4; // 0 Placed, 1 Picked up, 2 In transit, 3 Out for delivery, 4 Delivered

const app = express();
app.use(express.json());

// CORS: lets the front end (running on another port) call this API.
const ALLOWED_ORIGIN = process.env.FRONTEND_ORIGIN || "*";
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.get("/", (req, res) => res.json({ app: "Trackly API", status: "running" }));

/* ---------- helpers ---------- */
const digits = (s) => String(s || "").replace(/\D/g, "");
const text = (s) => String(s || "").trim();

// Middleware: requires a valid token and one of the given roles.
function auth(...roles) {
  return (req, res, next) => {
    try {
      const token = (req.headers.authorization || "").replace("Bearer ", "");
      const user = jwt.verify(token, SECRET);
      if (!roles.includes(user.role)) return res.status(403).json({ error: "You are not allowed to do this" });
      req.user = user;
      next();
    } catch {
      res.status(401).json({ error: "Please sign in again" });
    }
  };
}

const ORDER_SQL = `SELECT o.*, u.name AS boy_name, u.phone AS boy_phone
                   FROM orders o LEFT JOIN users u ON u.id = o.boy_id`;

const history = (id) => db.prepare("SELECT status, at FROM order_history WHERE order_id = ?").all(id);

// Moves an order to a status and records a timestamp for every stage reached.
function setStatus(id, status) {
  db.prepare("UPDATE orders SET status = ? WHERE id = ?").run(status, id);
  const add = db.prepare("INSERT OR IGNORE INTO order_history (order_id, status, at) VALUES (?,?,?)");
  for (let s = 0; s <= status; s++) add.run(id, s, new Date().toISOString());
}

/* ---------- auth ---------- */
app.post("/api/login", (req, res) => {
  const u = db.prepare("SELECT * FROM users WHERE phone = ?").get(digits(req.body.phone));
  if (!u || !bcrypt.compareSync(String(req.body.password || ""), u.password_hash))
    return res.status(401).json({ error: "Wrong phone number or password" });
  const user = { id: u.id, name: u.name, role: u.role };
  res.json({ token: jwt.sign(user, SECRET, { expiresIn: "12h" }), user });
});

/* ---------- public: customer tracking ---------- */
app.get("/api/track/:q", (req, res) => {
  const q = text(req.params.q).toUpperCase();
  const phone = digits(q);
  const o = db.prepare(ORDER_SQL + " WHERE o.code = ? OR o.customer_phone = ? ORDER BY o.id DESC LIMIT 1")
    .get(q, phone.length === 10 ? phone : "-");
  if (!o) return res.status(404).json({ error: "No parcel found for that ID or phone number" });
  delete o.customer_phone; // do not expose the customer's number publicly
  o.history = history(o.id);
  res.json(o);
});

/* ---------- admin ---------- */
app.get("/api/stats", auth("admin"), (req, res) => {
  const c = (sql) => db.prepare(sql).get().c;
  res.json({
    total: c("SELECT COUNT(*) c FROM orders"),
    active: c("SELECT COUNT(*) c FROM orders WHERE status < 4"),
    delivered: c("SELECT COUNT(*) c FROM orders WHERE status = 4"),
    boys: c("SELECT COUNT(*) c FROM users WHERE role = 'boy'"),
  });
});

app.get("/api/orders", auth("admin"), (req, res) => {
  res.json(db.prepare(ORDER_SQL + " ORDER BY o.id DESC").all());
});

app.post("/api/orders", auth("admin"), (req, res) => {
  const b = req.body;
  const o = {
    name: text(b.customer_name), phone: digits(b.customer_phone), address: text(b.address),
    landmark: text(b.landmark), pincode: digits(b.pincode), pickup: text(b.pickup),
    area: text(b.area), item: text(b.item), boy: b.boy_id ? Number(b.boy_id) : null,
  };
  if (!o.name || !o.address || !o.item || !o.area) return res.status(400).json({ error: "Fill in the customer name, address, area and item" });
  if (o.phone.length !== 10) return res.status(400).json({ error: "Phone must be 10 digits" });
  if (o.pincode.length !== 6) return res.status(400).json({ error: "Pincode must be 6 digits" });
  if (o.boy && !db.prepare("SELECT id FROM users WHERE id = ? AND role = 'boy'").get(o.boy))
    return res.status(400).json({ error: "That delivery boy does not exist" });

  const id = db.prepare(`INSERT INTO orders
    (customer_name, customer_phone, address, landmark, pincode, pickup, area, item, boy_id, status)
    VALUES (?,?,?,?,?,?,?,?,?,0)`).run(o.name, o.phone, o.address, o.landmark, o.pincode, o.pickup, o.area, o.item, o.boy).lastInsertRowid;
  const code = "TRK" + (1000 + Number(id));
  db.prepare("UPDATE orders SET code = ? WHERE id = ?").run(code, id);
  setStatus(id, 0);
  res.status(201).json({ code });
});

app.patch("/api/orders/:code", auth("admin"), (req, res) => {
  const o = db.prepare("SELECT * FROM orders WHERE code = ?").get(req.params.code);
  if (!o) return res.status(404).json({ error: "Order not found" });
  if ("boy_id" in req.body) {
    const boy = req.body.boy_id ? Number(req.body.boy_id) : null;
    if (boy && !db.prepare("SELECT id FROM users WHERE id = ? AND role = 'boy'").get(boy))
      return res.status(400).json({ error: "That delivery boy does not exist" });
    db.prepare("UPDATE orders SET boy_id = ? WHERE id = ?").run(boy, o.id);
  }
  if ("status" in req.body) {
    const st = Number(req.body.status);
    if (!Number.isInteger(st) || st < 0 || st > LAST_STAGE) return res.status(400).json({ error: "Invalid status" });
    db.prepare("DELETE FROM order_history WHERE order_id = ? AND status > ?").run(o.id, st);
    setStatus(o.id, st);
  }
  res.json({ ok: true });
});

app.delete("/api/orders/:code", auth("admin"), (req, res) => {
  const o = db.prepare("SELECT id FROM orders WHERE code = ?").get(req.params.code);
  if (!o) return res.status(404).json({ error: "Order not found" });
  db.prepare("DELETE FROM order_history WHERE order_id = ?").run(o.id);
  db.prepare("DELETE FROM orders WHERE id = ?").run(o.id);
  res.json({ ok: true });
});

app.get("/api/boys", auth("admin"), (req, res) => {
  res.json(db.prepare(`SELECT u.id, u.name, u.phone, u.area,
      (SELECT COUNT(*) FROM orders o WHERE o.boy_id = u.id AND o.status < 4) AS active
      FROM users u WHERE u.role = 'boy' ORDER BY u.id`).all());
});

app.post("/api/boys", auth("admin"), (req, res) => {
  const name = text(req.body.name), phone = digits(req.body.phone), area = text(req.body.area), pw = String(req.body.password || "");
  if (!name) return res.status(400).json({ error: "Enter the delivery boy's name" });
  if (phone.length !== 10) return res.status(400).json({ error: "Phone must be 10 digits" });
  if (pw.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });
  try {
    db.prepare("INSERT INTO users (name, phone, password_hash, role, area) VALUES (?,?,?,?,?)")
      .run(name, phone, bcrypt.hashSync(pw, 10), "boy", area);
    res.status(201).json({ ok: true });
  } catch {
    res.status(400).json({ error: "A user with that phone number already exists" });
  }
});

app.delete("/api/boys/:id", auth("admin"), (req, res) => {
  db.prepare("UPDATE orders SET boy_id = NULL WHERE boy_id = ?").run(req.params.id);
  db.prepare("DELETE FROM users WHERE id = ? AND role = 'boy'").run(req.params.id);
  res.json({ ok: true });
});

/* ---------- delivery boy ---------- */
app.get("/api/my/orders", auth("boy"), (req, res) => {
  res.json(db.prepare(ORDER_SQL + " WHERE o.boy_id = ? ORDER BY (o.status = 4), o.id DESC").all(req.user.id));
});

app.post("/api/my/orders/:code/advance", auth("boy"), (req, res) => {
  const o = db.prepare("SELECT * FROM orders WHERE code = ? AND boy_id = ?").get(req.params.code, req.user.id);
  if (!o) return res.status(404).json({ error: "That parcel is not assigned to you" });
  if (o.status >= LAST_STAGE) return res.status(400).json({ error: "Already delivered" });
  setStatus(o.id, o.status + 1);
  res.json({ ok: true });
});

/* ---------- fallbacks ---------- */
app.use("/api", (req, res) => res.status(404).json({ error: "Not found" }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Server error" });
});

app.listen(PORT, () => console.log("Trackly API running at http://localhost:" + PORT));
