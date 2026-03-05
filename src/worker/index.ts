import { Hono } from "hono";
import { cors } from "hono/cors";
import { getCookie, setCookie } from "hono/cookie";
import { sign, verify } from "hono/jwt";

interface Env {
  DB: D1Database;
}

type Variables = {
  user: {
    id: string;
    email: string;
    name: string;
  };
};

const JWT_SECRET = "my-super-secret-local-key";

const authMiddleware = async (c: any, next: any) => {
  const token = getCookie(c, "auth_token");
  if (!token) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  try {
    const payload = await verify(token, JWT_SECRET, "HS256");
    c.set("user", payload as Variables["user"]);
    await next();
  } catch (e) {
    return c.json({ error: "Unauthorized" }, 401);
  }
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use("/api/*", cors());

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: err.message }, 500);
});

// ============ AUTH ============

app.post("/api/auth/signup", async (c) => {
  const { email, password, name } = await c.req.json();
  const existing = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
  if (existing) return c.json({ error: "Email already in use" }, 400);

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    "INSERT INTO users (id, email, name, password) VALUES (?, ?, ?, ?)"
  ).bind(id, email, name, password).run();

  const token = await sign({ id, email, name }, JWT_SECRET);
  setCookie(c, "auth_token", token, { httpOnly: true, path: "/", sameSite: "Lax", secure: true });
  
  return c.json({ success: true, user: { id, email, name } });
});

app.post("/api/auth/login", async (c) => {
  const { email, password } = await c.req.json();
  const user: any = await c.env.DB.prepare(
    "SELECT * FROM users WHERE email = ? AND password = ?"
  ).bind(email, password).first();
  
  if (!user) return c.json({ error: "Invalid email or password" }, 401);

  const token = await sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET);
  setCookie(c, "auth_token", token, { httpOnly: true, path: "/", sameSite: "Lax", secure: true });
  
  return c.json({ success: true, user: { id: user.id, email: user.email, name: user.name } });
});

app.post("/api/auth/logout", async (c) => {
  setCookie(c, "auth_token", "", { maxAge: 0, path: "/" });
  return c.json({ success: true });
});

app.get("/api/users/me", authMiddleware, async (c) => {
  return c.json(c.get("user"));
});

// ============ GROUPS ============

app.get("/api/groups", authMiddleware, async (c) => {
  const user = c.get("user");
  const groups = await c.env.DB.prepare(`
    SELECT g.*, 
      (SELECT COUNT(*) FROM members WHERE group_id = g.id) as member_count,
      (SELECT COUNT(*) FROM expenses WHERE group_id = g.id) as expense_count
    FROM groups g
    WHERE g.user_id = ?
    ORDER BY g.created_at DESC
  `).bind(user.id).all();
  return c.json(groups.results);
});

app.post("/api/groups", authMiddleware, async (c) => {
  const user = c.get("user");
  const { name } = await c.req.json();
  const result = await c.env.DB.prepare(
    "INSERT INTO groups (name, user_id) VALUES (?, ?) RETURNING *"
  ).bind(name || "New Group", user.id).first();
  return c.json(result, 201);
});

app.patch("/api/groups/:id", authMiddleware, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const { name } = await c.req.json();
  const result = await c.env.DB.prepare(
    "UPDATE groups SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? RETURNING *"
  ).bind(name, id, user.id).first();
  return c.json(result);
});

app.delete("/api/groups/:id", authMiddleware, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const group = await c.env.DB.prepare("SELECT id FROM groups WHERE id = ? AND user_id = ?").bind(id, user.id).first();
  if (!group) return c.json({ error: "Group not found" }, 404);

  const statements = [
    c.env.DB.prepare("DELETE FROM payments WHERE group_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM expense_splits WHERE expense_id IN (SELECT id FROM expenses WHERE group_id = ?)").bind(id),
    c.env.DB.prepare("DELETE FROM expenses WHERE group_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM members WHERE group_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM groups WHERE id = ?").bind(id)
  ];
  await c.env.DB.batch(statements);
  return c.json({ success: true });
});

async function getGroupDetails(db: D1Database, groupId: string | number) {
  const members = await db.prepare("SELECT * FROM members WHERE group_id = ? ORDER BY created_at").bind(groupId).all();
  const expenses = await db.prepare("SELECT * FROM expenses WHERE group_id = ? ORDER BY expense_date DESC, created_at DESC").bind(groupId).all();
  const payments = await db.prepare("SELECT * FROM payments WHERE group_id = ? ORDER BY payment_date DESC, created_at DESC").bind(groupId).all();

  const expenseIds = expenses.results.map((e: any) => e.id);
  let splits: any[] = [];
  if (expenseIds.length > 0) {
    const placeholders = expenseIds.map(() => "?").join(",");
    const splitsResult = await db.prepare(`SELECT * FROM expense_splits WHERE expense_id IN (${placeholders})`).bind(...expenseIds).all();
    splits = splitsResult.results;
  }

  return {
    members: members.results,
    expenses: expenses.results.map((e: any) => {
      const expenseSplits = splits.filter((s: any) => s.expense_id === e.id);
      const splitAmounts: { [key: number]: number } = {};
      expenseSplits.forEach((s: any) => { splitAmounts[s.member_id] = s.amount; });
      return {
        ...e,
        splitAmong: expenseSplits.map((s: any) => s.member_id),
        splitAmounts,
      };
    }),
    payments: payments.results,
  };
}

app.get("/api/groups/:id/shared", authMiddleware, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const group = await c.env.DB.prepare("SELECT * FROM groups WHERE id = ?").bind(id).first();
  if (!group) return c.json({ error: "Group not found" }, 404);

  const isOwner = (group as any).user_id === user.id;
  const collaborator = await c.env.DB.prepare("SELECT can_edit FROM group_collaborators WHERE group_id = ? AND user_id = ?").bind(id, user.id).first();
  const canEdit = isOwner || (collaborator && (collaborator as any).can_edit === 1);
  const pendingRequest = await c.env.DB.prepare("SELECT id FROM access_requests WHERE group_id = ? AND user_id = ? AND status = 'pending'").bind(id, user.id).first();

  const details = await getGroupDetails(c.env.DB, id);
  return c.json({ ...group, isOwner, canEdit, hasPendingRequest: !!pendingRequest, ...details });
});

// ============ MEMBERS ============

app.post("/api/groups/:groupId/members", authMiddleware, async (c) => {
  const user = c.get("user");
  const groupId = c.req.param("groupId");
  const group = await c.env.DB.prepare("SELECT id FROM groups WHERE id = ? AND user_id = ?").bind(groupId, user.id).first();
  if (!group) return c.json({ error: "Unauthorized" }, 403);

  const { name } = await c.req.json();
  const result = await c.env.DB.prepare("INSERT INTO members (group_id, name) VALUES (?, ?) RETURNING *").bind(groupId, name || "New Member").first();
  return c.json(result, 201);
});

app.delete("/api/members/:id", authMiddleware, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const member = await c.env.DB.prepare(`SELECT m.id FROM members m JOIN groups g ON m.group_id = g.id WHERE m.id = ? AND g.user_id = ?`).bind(id, user.id).first();
  if (!member) return c.json({ error: "Unauthorized" }, 403);

  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM expense_splits WHERE member_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM members WHERE id = ?").bind(id)
  ]);
  return c.json({ success: true });
});

// ============ EXPENSES (FIXED D1_TYPE_ERROR) ============

app.post("/api/groups/:groupId/expenses", authMiddleware, async (c) => {
  const groupId = c.req.param("groupId");
  const { description, amount, paidByMemberId, splitAmong, splitType, splitAmounts, date } = await c.req.json();

  // FIX: Provide explicit fallback values to prevent "undefined" crashing D1
  const cleanDescription = description || "No Description";
  const cleanAmount = parseFloat(amount) || 0;
  const cleanPaidBy = paidByMemberId || 0;
  const cleanDate = date || new Date().toISOString().split("T")[0];
  const cleanType = splitType || 'equal';

  const expense: any = await c.env.DB.prepare(
    "INSERT INTO expenses (group_id, description, amount, paid_by_member_id, expense_date, split_type) VALUES (?, ?, ?, ?, ?, ?) RETURNING *"
  ).bind(groupId, cleanDescription, cleanAmount, cleanPaidBy, cleanDate, cleanType).first();

  if (!expense) return c.json({ error: "Failed to create expense" }, 500);

  const equalAmount = cleanAmount / (splitAmong?.length || 1);
  const splitStatements = (splitAmong || []).map((mId: number) => {
    const val = (cleanType === 'custom' && splitAmounts) ? (parseFloat(splitAmounts[mId]) || 0) : equalAmount;
    return c.env.DB.prepare("INSERT INTO expense_splits (expense_id, member_id, amount) VALUES (?, ?, ?)").bind(expense.id, mId, val);
  });

  if (splitStatements.length > 0) {
    await c.env.DB.batch(splitStatements);
  }
  
  return c.json({ ...expense, splitAmong, splitAmounts }, 201);
});

app.delete("/api/expenses/:id", authMiddleware, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const expense = await c.env.DB.prepare(`SELECT e.id FROM expenses e JOIN groups g ON e.group_id = g.id WHERE e.id = ? AND g.user_id = ?`).bind(id, user.id).first();
  if (!expense) return c.json({ error: "Unauthorized" }, 403);

  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM expense_splits WHERE expense_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM expenses WHERE id = ?").bind(id)
  ]);
  return c.json({ success: true });
});

// ============ PAYMENTS ============

app.post("/api/groups/:groupId/payments", authMiddleware, async (c) => {
  const groupId = c.req.param("groupId");
  const { fromMemberId, toMemberId, amount, date } = await c.req.json();
  const payment = await c.env.DB.prepare(
    "INSERT INTO payments (group_id, from_member_id, to_member_id, amount, payment_date) VALUES (?, ?, ?, ?, ?) RETURNING *"
  ).bind(groupId, fromMemberId || 0, toMemberId || 0, parseFloat(amount) || 0, date || new Date().toISOString().split("T")[0]).first();
  return c.json(payment, 201);
});

app.delete("/api/payments/:id", authMiddleware, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const payment = await c.env.DB.prepare(`SELECT p.id FROM payments p JOIN groups g ON p.group_id = g.id WHERE p.id = ? AND g.user_id = ?`).bind(id, user.id).first();
  if (!payment) return c.json({ error: "Unauthorized" }, 403);

  await c.env.DB.prepare("DELETE FROM payments WHERE id = ?").bind(id).run();
  return c.json({ success: true });
});

// ============ ACCESS REQUESTS ============

app.post("/api/groups/:id/request-access", authMiddleware, async (c) => {
  const user = c.get("user");
  const groupId = c.req.param("id");
  const group: any = await c.env.DB.prepare("SELECT user_id FROM groups WHERE id = ?").bind(groupId).first();
  if (!group) return c.json({ error: "Not found" }, 404);
  if (group.user_id === user.id) return c.json({ error: "Owner" }, 400);

  await c.env.DB.prepare("INSERT INTO access_requests (group_id, user_id, user_email, status) VALUES (?, ?, ?, 'pending')").bind(groupId, user.id, user.email).run();
  return c.json({ success: true }, 201);
});

app.get("/api/access-requests", authMiddleware, async (c) => {
  const user = c.get("user");
  const requests = await c.env.DB.prepare(`SELECT ar.*, g.name as group_name FROM access_requests ar JOIN groups g ON ar.group_id = g.id WHERE g.user_id = ? AND ar.status = 'pending'`).bind(user.id).all();
  return c.json(requests.results);
});

app.post("/api/access-requests/:id/approve", authMiddleware, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  
  // FIX: Line 204 error removed - 'user' is now used to verify ownership
  const req: any = await c.env.DB.prepare(`SELECT ar.*, g.user_id as owner FROM access_requests ar JOIN groups g ON ar.group_id = g.id WHERE ar.id = ?`).bind(id).first();
  if (!req || req.owner !== user.id) return c.json({ error: "Denied" }, 403);

  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE access_requests SET status = 'approved' WHERE id = ?").bind(id),
    c.env.DB.prepare("INSERT INTO group_collaborators (group_id, user_id, user_email, can_edit) VALUES (?, ?, ?, 1)").bind(req.group_id, req.user_id, req.user_email)
  ]);
  return c.json({ success: true });
});

export default app;