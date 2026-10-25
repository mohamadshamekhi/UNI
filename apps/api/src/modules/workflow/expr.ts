// Declarative condition language for workflow transitions (WF-03). Parsed to an AST and evaluated
// against a frozen scope. No function calls, assignment, loops or prototype access — by grammar.
//
//   expr    := or
//   or      := and ( "||" and )*
//   and     := not ( "&&" not )*
//   not     := "!" not | cmp
//   cmp     := primary ( ("=="|"!="|"<"|"<="|">"|">="|"in") primary )?
//   primary := number | string | true | false | null | path | "[" list "]" | "(" expr ")"
//   path    := ident ( "." ident )*

export type Expr =
  | { k: "lit"; v: number | string | boolean | null }
  | { k: "list"; items: Expr[] }
  | { k: "path"; parts: string[] }
  | { k: "not"; e: Expr }
  | { k: "bin"; op: "&&" | "||" | "==" | "!=" | "<" | "<=" | ">" | ">=" | "in"; l: Expr; r: Expr };

export class ExprError extends Error {
  constructor(
    message: string,
    readonly pos: number,
  ) {
    super(message);
  }
}

type Tok = { t: "num" | "str" | "id" | "op" | "eof"; v: string; pos: number };

const MAX_LEN = 500;
const MAX_DEPTH = 32;
const FORBIDDEN = new Set(["__proto__", "prototype", "constructor"]);
/** Roots a condition may read from. */
export const ROOTS = new Set(["data", "case", "actor"]);

function tokenize(src: string): Tok[] {
  if (src.length > MAX_LEN) throw new ExprError("expression too long", 0);
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const start = i;
    if (/[0-9]/.test(c)) {
      while (i < src.length && /[0-9.]/.test(src[i]!)) i++;
      out.push({ t: "num", v: src.slice(start, i), pos: start });
      continue;
    }
    if (c === "'" || c === '"') {
      i++;
      let s = "";
      while (i < src.length && src[i] !== c) {
        if (src[i] === "\\" && i + 1 < src.length) i++;
        s += src[i];
        i++;
      }
      if (src[i] !== c) throw new ExprError("unterminated string", start);
      i++;
      out.push({ t: "str", v: s, pos: start });
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      while (i < src.length && /[A-Za-z0-9_]/.test(src[i]!)) i++;
      out.push({ t: "id", v: src.slice(start, i), pos: start });
      continue;
    }
    const two = src.slice(i, i + 2);
    if (["==", "!=", "<=", ">=", "&&", "||"].includes(two)) {
      out.push({ t: "op", v: two, pos: i });
      i += 2;
      continue;
    }
    if ("<>!()[].,".includes(c)) {
      out.push({ t: "op", v: c, pos: i });
      i++;
      continue;
    }
    throw new ExprError(`unexpected character '${c}'`, i);
  }
  out.push({ t: "eof", v: "", pos: src.length });
  return out;
}

export function parseExpr(src: string): Expr {
  const toks = tokenize(src);
  let p = 0;
  let depth = 0;
  const peek = () => toks[p]!;
  const next = () => toks[p++]!;
  const isOp = (v: string) => peek().t === "op" && peek().v === v;
  const expect = (v: string) => {
    if (!isOp(v)) throw new ExprError(`expected '${v}'`, peek().pos);
    next();
  };
  const guard = <T>(fn: () => T): T => {
    if (++depth > MAX_DEPTH) throw new ExprError("expression too deeply nested", peek().pos);
    try {
      return fn();
    } finally {
      depth--;
    }
  };

  const or = (): Expr =>
    guard(() => {
      let l = and();
      while (isOp("||")) {
        next();
        l = { k: "bin", op: "||", l, r: and() };
      }
      return l;
    });
  const and = (): Expr => {
    let l = not();
    while (isOp("&&")) {
      next();
      l = { k: "bin", op: "&&", l, r: not() };
    }
    return l;
  };
  const not = (): Expr => {
    if (isOp("!")) {
      next();
      return guard(() => ({ k: "not", e: not() }));
    }
    return cmp();
  };
  const cmp = (): Expr => {
    const l = primary();
    const t = peek();
    if (t.t === "op" && ["==", "!=", "<", "<=", ">", ">="].includes(t.v)) {
      next();
      return { k: "bin", op: t.v as "==", l, r: primary() };
    }
    if (t.t === "id" && t.v === "in") {
      next();
      return { k: "bin", op: "in", l, r: primary() };
    }
    return l;
  };
  const primary = (): Expr => {
    const t = next();
    if (t.t === "num") {
      const n = Number(t.v);
      if (!Number.isFinite(n)) throw new ExprError("invalid number", t.pos);
      return { k: "lit", v: n };
    }
    if (t.t === "str") return { k: "lit", v: t.v };
    if (t.t === "id") {
      if (t.v === "true" || t.v === "false") return { k: "lit", v: t.v === "true" };
      if (t.v === "null") return { k: "lit", v: null };
      if (!ROOTS.has(t.v)) throw new ExprError(`unknown name '${t.v}' (use data., case. or actor.)`, t.pos);
      const parts = [t.v];
      while (isOp(".")) {
        next();
        const id = next();
        if (id.t !== "id" || FORBIDDEN.has(id.v)) throw new ExprError("invalid property name", id.pos);
        parts.push(id.v);
      }
      return { k: "path", parts };
    }
    if (t.t === "op" && t.v === "(") {
      const e = or();
      expect(")");
      return e;
    }
    if (t.t === "op" && t.v === "[") {
      const items: Expr[] = [];
      if (!isOp("]")) {
        do items.push(primary());
        while (isOp(",") && next());
      }
      expect("]");
      return { k: "list", items };
    }
    throw new ExprError("unexpected token", t.pos);
  };

  const ast = or();
  if (peek().t !== "eof") throw new ExprError("unexpected trailing input", peek().pos);
  return ast;
}

type Value = unknown;

function read(scope: Record<string, unknown>, parts: string[]): Value {
  let cur: unknown = scope;
  for (const key of parts) {
    if (cur === null || typeof cur !== "object" || !Object.hasOwn(cur, key)) return null;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur ?? null;
}

const truthy = (v: Value) => v !== null && v !== false && v !== 0 && v !== "";

export function evalExpr(e: Expr, scope: Record<string, unknown>): Value {
  switch (e.k) {
    case "lit":
      return e.v;
    case "list":
      return e.items.map((i) => evalExpr(i, scope));
    case "path":
      return read(scope, e.parts);
    case "not":
      return !truthy(evalExpr(e.e, scope));
    case "bin": {
      if (e.op === "&&") return truthy(evalExpr(e.l, scope)) && truthy(evalExpr(e.r, scope));
      if (e.op === "||") return truthy(evalExpr(e.l, scope)) || truthy(evalExpr(e.r, scope));
      const l = evalExpr(e.l, scope);
      const r = evalExpr(e.r, scope);
      switch (e.op) {
        case "==":
          return l === r;
        case "!=":
          return l !== r;
        case "in":
          return Array.isArray(r) ? r.includes(l) : typeof r === "string" && typeof l === "string" ? r.includes(l) : false;
        default: {
          // ordering only between two numbers or two strings; anything else is false
          if (!((typeof l === "number" && typeof r === "number") || (typeof l === "string" && typeof r === "string"))) return false;
          return e.op === "<" ? l < r : e.op === "<=" ? l <= r : e.op === ">" ? l > r : l >= r;
        }
      }
    }
  }
}

export const evaluateCondition = (src: string, scope: Record<string, unknown>) => truthy(evalExpr(parseExpr(src), scope));

/** Paths a condition reads, e.g. ["data.degree"] — used by the validator. */
export function referencedPaths(e: Expr, out: string[] = []): string[] {
  if (e.k === "path") out.push(e.parts.join("."));
  else if (e.k === "list") e.items.forEach((i) => referencedPaths(i, out));
  else if (e.k === "not") referencedPaths(e.e, out);
  else if (e.k === "bin") {
    referencedPaths(e.l, out);
    referencedPaths(e.r, out);
  }
  return out;
}
