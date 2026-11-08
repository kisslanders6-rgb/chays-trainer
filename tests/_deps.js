// Analyse des scripts d'index.html : qui utilise quel nom global (portées comprises), sans rien exécuter.
const fs = require('fs'), path = require('path');
const acorn = require('acorn');
const ROOT = path.join(__dirname, '..');

function bindNames(p, add) {
    if (!p) return;
    if (p.type === 'Identifier') add(p.name);
    else if (p.type === 'ObjectPattern') p.properties.forEach(q => bindNames(q.type === 'RestElement' ? q.argument : q.value, add));
    else if (p.type === 'ArrayPattern') p.elements.forEach(q => bindNames(q, add));
    else if (p.type === 'AssignmentPattern') bindNames(p.left, add);
    else if (p.type === 'RestElement') bindNames(p.argument, add);
}

function hoistVars(n, add) {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(x => hoistVars(x, add)); return; }
    if (/Function/.test(n.type)) return;
    if (n.type === 'VariableDeclaration' && n.kind === 'var') n.declarations.forEach(d => bindNames(d.id, add));
    for (const k in n) if (k !== 'loc' && n[k] && typeof n[k] === 'object') hoistVars(n[k], add);
}

function declareBlock(body, scope) {
    for (const b of body) {
        if (b.type === 'VariableDeclaration' && b.kind !== 'var') b.declarations.forEach(d => bindNames(d.id, x => scope.names.add(x)));
        if (b.type === 'ClassDeclaration' || b.type === 'FunctionDeclaration') scope.names.add(b.id.name);
    }
}

// Renvoie { top : noms de premier niveau, free : usages de noms de premier niveau ou inconnus, avec deferred (dans une fonction) }.
function analyse(source) {
    const ast = acorn.parse(source, { ecmaVersion: 'latest', locations: true });
    const free = [];
    const find = (scope, name) => { for (let s = scope; s; s = s.parent) if (s.names.has(name)) return s; return null; };
    const child = parent => ({ parent, names: new Set() });

    function fn(n, scope, deferred, iife) {
        const f = child(scope);
        if (n.id && n.type === 'FunctionExpression') f.names.add(n.id.name);
        n.params.forEach(p => bindNames(p, x => f.names.add(x)));
        n.params.forEach(p => { if (p.type === 'AssignmentPattern') visit(p.right, f, true); });
        const inner = iife ? deferred : true;
        if (n.body.type === 'BlockStatement') {
            hoistVars(n.body.body, x => f.names.add(x));
            declareBlock(n.body.body, f);
            n.body.body.forEach(c => visit(c, f, inner));
        } else visit(n.body, f, inner);
    }

    function visit(n, scope, deferred) {
        if (!n) return;
        if (Array.isArray(n)) { n.forEach(x => visit(x, scope, deferred)); return; }
        switch (n.type) {
            case 'Identifier': {
                const s = find(scope, n.name);
                if (!s || s.top) free.push({ name: n.name, line: n.loc.start.line, deferred });
                return;
            }
            case 'FunctionDeclaration': case 'FunctionExpression': case 'ArrowFunctionExpression': fn(n, scope, deferred, false); return;
            case 'CallExpression':
                if (n.callee.type === 'FunctionExpression' || n.callee.type === 'ArrowFunctionExpression') fn(n.callee, scope, deferred, true);
                else visit(n.callee, scope, deferred);
                visit(n.arguments, scope, deferred);
                return;
            case 'MemberExpression': visit(n.object, scope, deferred); if (n.computed) visit(n.property, scope, deferred); return;
            case 'Property': if (n.computed) visit(n.key, scope, deferred); visit(n.value, scope, deferred); return;
            case 'MethodDefinition': case 'PropertyDefinition': if (n.computed) visit(n.key, scope, deferred); visit(n.value, scope, true); return;
            case 'BlockStatement': { const b = child(scope); declareBlock(n.body, b); n.body.forEach(c => visit(c, b, deferred)); return; }
            case 'ForStatement': case 'ForInStatement': case 'ForOfStatement': {
                const b = child(scope), i = n.init || n.left;
                if (i && i.type === 'VariableDeclaration' && i.kind !== 'var') i.declarations.forEach(d => bindNames(d.id, x => b.names.add(x)));
                ['init', 'left', 'test', 'right', 'update', 'body'].forEach(k => { if (n[k]) visit(n[k], b, deferred); });
                return;
            }
            case 'SwitchStatement': {
                visit(n.discriminant, scope, deferred);
                const b = child(scope);
                n.cases.forEach(c => declareBlock(c.consequent, b));
                n.cases.forEach(c => { visit(c.test, b, deferred); visit(c.consequent, b, deferred); });
                return;
            }
            case 'CatchClause': { const b = child(scope); bindNames(n.param, x => b.names.add(x)); visit(n.body, b, deferred); return; }
            case 'ClassDeclaration': case 'ClassExpression': visit(n.superClass, scope, deferred); n.body.body.forEach(x => visit(x, scope, deferred)); return;
            case 'VariableDeclaration': n.declarations.forEach(d => { visitPattern(d.id, scope, deferred); visit(d.init, scope, deferred); }); return;
            case 'LabeledStatement': visit(n.body, scope, deferred); return;
            case 'BreakStatement': case 'ContinueStatement': return;
            default:
                for (const k in n) if (!['loc', 'type', 'start', 'end'].includes(k) && n[k] && typeof n[k] === 'object') visit(n[k], scope, deferred);
        }
    }
    function visitPattern(p, scope, deferred) {
        if (p && p.type === 'ObjectPattern') p.properties.forEach(q => {
            if (q.computed) visit(q.key, scope, deferred);
            if (q.value && q.value.type === 'AssignmentPattern') visit(q.value.right, scope, deferred);
        });
    }

    const top = { parent: null, names: new Set(), top: true };
    hoistVars(ast.body, x => top.names.add(x));
    declareBlock(ast.body, top);
    ast.body.forEach(c => visit(c, top, false));
    return { top: top.names, free };
}

// Scripts dans l'ordre d'index.html, avec pour chacun les fichiers et les noms dont il dépend.
function loadGraph() {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const files = [...html.matchAll(/<script[^>]*\ssrc="(js\/[^"?]+)"/g)].map(m => m[1]);
    const info = {}, owner = {};
    for (const f of files) {
        info[f] = analyse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
        for (const n of info[f].top) if (!owner[n]) owner[n] = f;
    }
    const deps = {}, unknown = new Set(), earlyUse = [];
    for (const f of files) {
        deps[f] = {};
        for (const r of info[f].free) {
            const o = owner[r.name];
            if (!o) { unknown.add(r.name); continue; }
            if (o === f) continue;
            (deps[f][o] = deps[f][o] || new Set()).add(r.name);
            if (!r.deferred && files.indexOf(o) > files.indexOf(f)) earlyUse.push(`${f}:${r.line} ${r.name}`);
        }
    }
    return { files, deps, unknown, earlyUse };
}

module.exports = { analyse, loadGraph };
