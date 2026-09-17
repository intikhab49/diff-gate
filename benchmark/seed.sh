#!/bin/bash
# Seeds a small repo that already contains reusable helpers, so re-implementation is measurable.
d="$1"
mkdir -p "$d/src/lib" "$d/src/routes"
cat > "$d/package.json" <<'JSON'
{
  "name": "shopdesk",
  "type": "module",
  "dependencies": {
    "express": "^4.21.0"
  }
}
JSON
cat > "$d/src/lib/format.js" <<'JS'
// Shared formatting helpers. Used across routes.
export function formatMoney(cents, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}

export function formatDate(iso) {
  return new Date(iso).toISOString().slice(0, 10);
}

export function slugify(title) {
  return title.normalize('NFKD').replace(/[^\w\s-]/g, '').trim().toLowerCase().replace(/\s+/g, '-');
}
JS
cat > "$d/src/lib/validate.js" <<'JS'
// Shared validation helpers. Used across routes.
export function isEmail(value) {
  return typeof value === 'string' && /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(value);
}

export function assertPositiveInt(value, field) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${field} must be a positive integer`);
  return value;
}
JS
cat > "$d/src/lib/store.js" <<'JS'
// In-memory data layer.
const items = [
  { id: 1, title: 'Blue Mug', priceCents: 1250, createdAt: '2026-01-04T10:00:00Z' },
  { id: 2, title: 'Desk Lamp', priceCents: 4999, createdAt: '2026-02-11T10:00:00Z' },
  { id: 3, title: 'Notebook', priceCents: 799, createdAt: '2026-03-02T10:00:00Z' }
];
const users = [{ id: 1, email: 'ada@example.com' }];

export function listItems() { return items; }
export function getItem(id) { return items.find(i => i.id === id); }
export function addUser(user) { users.push({ id: users.length + 1, ...user }); return users.at(-1); }
export function listUsers() { return users; }
JS
cat > "$d/src/routes/items.js" <<'JS'
import { Router } from 'express';
import { listItems, getItem } from '../lib/store.js';
import { formatMoney } from '../lib/format.js';

export const itemsRouter = Router();

itemsRouter.get('/items', (req, res) => {
  res.json(listItems().map(i => ({ ...i, price: formatMoney(i.priceCents) })));
});

itemsRouter.get('/items/:id', (req, res) => {
  const item = getItem(Number(req.params.id));
  if (!item) return res.status(404).json({ error: 'not found' });
  res.json({ ...item, price: formatMoney(item.priceCents) });
});
JS
cat > "$d/src/routes/users.js" <<'JS'
import { Router } from 'express';
import { addUser, listUsers } from '../lib/store.js';
import { isEmail } from '../lib/validate.js';

export const usersRouter = Router();

usersRouter.post('/users', (req, res) => {
  if (!isEmail(req.body?.email)) return res.status(400).json({ error: 'invalid email' });
  res.status(201).json(addUser({ email: req.body.email }));
});

usersRouter.get('/users', (req, res) => res.json(listUsers()));
JS
cat > "$d/src/server.js" <<'JS'
import express from 'express';
import { itemsRouter } from './routes/items.js';
import { usersRouter } from './routes/users.js';

export const app = express();
app.use(express.json());
app.use(itemsRouter);
app.use(usersRouter);
JS
cat > "$d/README.md" <<'MD'
# shopdesk

Small Express API. Shared helpers live in `src/lib/` (`format.js`, `validate.js`, `store.js`);
routes live in `src/routes/`.
MD
printf 'node_modules/
.diffgate/
' > "$d/.gitignore"
(cd "$d" && git init -q && git add -A && git -c user.email=b@b -c user.name=b commit -qm seed)
