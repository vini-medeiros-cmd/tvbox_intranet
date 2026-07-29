const STATUS_LABEL = { planejado: 'Planejado', fazendo: 'Fazendo', pendente: 'Pendente', concluido: 'Concluído' };

const ICONS = {
  eye: '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5Z"/><circle cx="8" cy="8" r="2"/></svg>',
  copy: '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="5" y="5" width="9" height="9" rx="1.5"/><path d="M3 10.5V3a1.5 1.5 0 0 1 1.5-1.5H11"/></svg>',
  pencil: '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M11 2l3 3-8 8H3v-3l8-8Z"/></svg>',
  trash: '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3 4h10M6 4V2.5h4V4M4.5 4l.6 9a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-9"/></svg>',
  link: '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M6.5 9.5 13 3M9 3h4v4M12 8.5V12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h3.5"/></svg>'
};

let projetos = [];
let atalhos = [];
let editandoId = null;

// ESC
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(m => m.classList.add('hidden'));
  }
});
function criarEmptyState(msg) {
  return el('div', { class: 'empty-state' }, [msg]);
}

// === RELÓGIO ===
function atualizarRelogio() {
  const agora = new Date();
  const opcoes = { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' };
  document.getElementById('relogio').textContent = agora.toLocaleDateString('pt-BR', opcoes);
}
setInterval(atualizarRelogio, 1000);
atualizarRelogio();

// === HELPERS ===
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(props).forEach(([k, v]) => {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'html') node.innerHTML = v;
    else node.setAttribute(k, v);
  });
  children.forEach(c => node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
  return node;
}
function formatarData(dataStr) {
  const [ano, mes, dia] = dataStr.split('-');
  return `${dia}/${mes}/${ano}`;
}
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
function formatarDataCurta(iso) {
  return new Date(iso).toLocaleDateString('pt-BR');
}

// === TOAST ===
let toastTimer;
function mostrarToast(msg, erro = false) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = el('div', { id: 'toast' });
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.toggle('erro', erro);
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2000);
}

// === PROJETOS ===
async function carregarProjetos() {
  const res = await fetch('/api/projetos');
  projetos = await res.json();
  renderizarProjetos();
}
async function salvarProjetos() {
  try {
    const res = await fetch('/api/projetos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(projetos) });
    if (!res.ok) throw new Error();
    projetos = await res.json();
    renderizarProjetos();
    mostrarToast('Salvo ✓');
  } catch {
    mostrarToast('Erro ao salvar', true);
  }
}
const gruposRecolhidos = new Set();
function agruparPorGrupo(lista) {
  const semGrupo = lista.filter(p => !p.grupo || !p.grupo.trim());
  const comGrupo = lista.filter(p => p.grupo && p.grupo.trim());
  const nomesGrupos = [...new Set(comGrupo.map(p => p.grupo.trim()))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  return {
    semGrupo,
    grupos: nomesGrupos.map(nome => ({ nome, itens: comGrupo.filter(p => p.grupo.trim() === nome) }))
  };
}
function renderizarGridComGrupos(container, lista, msgVazio) {
  container.innerHTML = '';
  if (lista.length === 0) {
    container.appendChild(criarEmptyState(msgVazio));
    return;
  }
  const { semGrupo, grupos } = agruparPorGrupo(lista);

  if (semGrupo.length) {
    const subGrid = el('div', { class: 'projetos-grid' });
    semGrupo.forEach(p => subGrid.appendChild(criarCardProjeto(p)));
    container.appendChild(subGrid);
  }

  grupos.forEach(({ nome, itens }) => {
    const recolhido = gruposRecolhidos.has(nome);
    const subGrid = el('div', { class: 'projetos-grid', style: recolhido ? 'display:none' : '' });
    itens.forEach(p => subGrid.appendChild(criarCardProjeto(p)));

    const titulo = el('div', {
      class: 'grupo-titulo',
      onclick: () => {
        if (gruposRecolhidos.has(nome)) gruposRecolhidos.delete(nome);
        else gruposRecolhidos.add(nome);
        renderizarProjetos();
      }
    }, [`${recolhido ? '▸' : '▾'} ${nome} (${itens.length})`]);

    container.appendChild(titulo);
    container.appendChild(subGrid);
  });
}
function renderizarProjetos() {
  const termo = document.getElementById('filtroProjetos').value.toLowerCase().trim();
  const statusFiltro = document.getElementById('filtroStatus').value;
  const filtrados = projetos.filter(p =>
    (!termo || p.nome.toLowerCase().includes(termo) || (p.descricao || '').toLowerCase().includes(termo) || (p.grupo || '').toLowerCase().includes(termo)) &&
    (statusFiltro === 'todos' || p.status === statusFiltro)
  );

  const gridAtivos = document.getElementById('gridProjetos');
  const gridArq = document.getElementById('gridArquivados');
  const toggleArq = document.getElementById('toggleArquivados');

  if (statusFiltro !== 'todos') {
    // Filtro de status ativo
    const ordenados = filtrados.sort((a, b) => a.prazo.localeCompare(b.prazo));
    renderizarGridComGrupos(gridAtivos, ordenados, 'Nenhum projeto encontrado.');
    gridArq.innerHTML = '';
    gridArq.style.display = 'none';
    toggleArq.style.display = 'none';
    return;
  }

  toggleArq.style.display = '';
  const ativos = filtrados.filter(p => p.status !== 'concluido').sort((a, b) => a.prazo.localeCompare(b.prazo));
  const concluidos = filtrados.filter(p => p.status === 'concluido').sort((a, b) => b.prazo.localeCompare(a.prazo));

  renderizarGridComGrupos(gridAtivos, ativos, 'Nenhum projeto encontrado.');

  gridArq.innerHTML = '';
  concluidos.forEach(p => gridArq.appendChild(criarCardProjeto(p)));
  document.getElementById('toggleArquivados').textContent = `Mostrar concluídos (${concluidos.length}) ▾`;
}
function criarCardProjeto(p) {
  const hoje = new Date().toISOString().slice(0, 10);
  const vencido = p.prazo < hoje && p.status !== 'concluido';

  const card = el('div', { class: 'card projeto-card', 'data-status': p.status });

  const topo = el('div', { class: 'projeto-topo' }, [
    el('div', { class: 'projeto-nome' }, [p.nome]),
    el('span', { class: `badge badge-${p.status}` }, [STATUS_LABEL[p.status]])
  ]);
  card.appendChild(topo);

  card.appendChild(el('div', { class: `projeto-prazo ${vencido ? 'vencido' : ''}` }, [
    `Prazo: ${formatarData(p.prazo)}${vencido ? ' — VENCIDO' : ''}`
  ]));

  if (p.descricao) card.appendChild(el('div', { class: 'projeto-desc', title: p.descricao }, [p.descricao]));
  if (p.link) card.appendChild(el('a', { class: 'projeto-link', href: p.link, target: '_blank', rel: 'noopener' }, [
    el('span', { html: ICONS.link, class: 'icone-inline' }),
    'Abrir link'
  ]));

  const notasWrap = el('div', { class: 'projeto-notas' });
  const textarea = el('textarea', { placeholder: 'Notas...' });
  textarea.value = p.notas || '';
  textarea.addEventListener('input', debounce(() => {
    p.notas = textarea.value;
    salvarProjetos();
  }, 500));
  notasWrap.appendChild(textarea);
  card.appendChild(notasWrap);

  if (p.criado_em) {
    let meta = `Criado em ${formatarDataCurta(p.criado_em)}`;
    if (p.modificado_em && p.modificado_em !== p.criado_em) meta += ` · Atualizado em ${formatarDataCurta(p.modificado_em)}`;
    card.appendChild(el('div', { class: 'projeto-meta' }, [meta]));
  }

  const acoes = el('div', { class: 'projeto-acoes' });
  Object.keys(STATUS_LABEL).forEach(st => {
    if (st !== p.status) {
      acoes.appendChild(el('button', {
        class: 'btn', title: `Mudar para ${STATUS_LABEL[st]}`,
        onclick: () => { p.status = st; salvarProjetos(); renderizarProjetos(); }
      }, [STATUS_LABEL[st]]));
    }
  });
  acoes.appendChild(el('button', { class: 'btn', onclick: () => abrirModalProjeto(p) }, ['Editar']));
  acoes.appendChild(el('button', {
    class: 'btn btn-danger', onclick: () => {
      if (confirm(`Excluir "${p.nome}"?`)) {
        projetos = projetos.filter(x => x.id !== p.id);
        salvarProjetos();
        renderizarProjetos();
      }
    }
  }, ['Excluir']));
  card.appendChild(acoes);

  return card;
}

document.getElementById('filtroProjetos').addEventListener('input', renderizarProjetos);
document.getElementById('filtroStatus').addEventListener('change', renderizarProjetos);
document.getElementById('toggleArquivados').addEventListener('click', () => {
  const grid = document.getElementById('gridArquivados');
  grid.style.display = grid.style.display === 'none' ? 'grid' : 'none';
});

// MODAL PROJETOS
const modalProjeto = document.getElementById('modalProjeto');
document.getElementById('btnNovoProjeto').addEventListener('click', () => abrirModalProjeto(null));
document.getElementById('btnCancelarProjeto').addEventListener('click', () => modalProjeto.classList.add('hidden'));
function abrirModalProjeto(p) {
  editandoId = p ? p.id : null;
  document.getElementById('modalProjetoTitulo').textContent = p ? 'Editar projeto' : 'Novo projeto';
  document.getElementById('campoNome').value = p ? p.nome : '';
  document.getElementById('campoGrupo').value = p ? (p.grupo || '') : '';
  document.getElementById('campoStatus').value = p ? p.status : 'planejado';
  document.getElementById('campoPrazo').value = p ? p.prazo : '';
  document.getElementById('campoDescricao').value = p ? (p.descricao || '') : '';
  document.getElementById('campoLink').value = p ? (p.link || '') : '';

  const gruposExistentes = [...new Set(projetos.map(x => (x.grupo || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const listaGrupos = document.getElementById('listaGrupos');
  listaGrupos.innerHTML = '';
  gruposExistentes.forEach(g => listaGrupos.appendChild(el('option', { value: g })));

  modalProjeto.classList.remove('hidden');
  setTimeout(() => document.getElementById('campoNome').focus(), 50);
}
document.getElementById('formProjeto').addEventListener('submit', (e) => {
  e.preventDefault();
  const dados = {
    nome: document.getElementById('campoNome').value.trim(),
    grupo: document.getElementById('campoGrupo').value.trim(),
    status: document.getElementById('campoStatus').value,
    prazo: document.getElementById('campoPrazo').value,
    descricao: document.getElementById('campoDescricao').value.trim(),
    link: document.getElementById('campoLink').value.trim()
  };
  if (editandoId) {
    const p = projetos.find(x => x.id === editandoId);
    Object.assign(p, dados);
  } else {
    const novoId = projetos.length ? Math.max(...projetos.map(x => x.id)) + 1 : 1;
    projetos.push({ id: novoId, notas: '', ...dados });
  }
  salvarProjetos();
  renderizarProjetos();
  modalProjeto.classList.add('hidden');
});

// === INFRA ===
async function carregarInfra() {
  const grid = document.getElementById('gridInfra');
  grid.innerHTML = '';
  grid.appendChild(el('p', { class: 'loading-pulse', style: 'color:var(--muted)' }, ['Verificando serviços...']));
  const res = await fetch('/api/infra');
  const dados = await res.json();
  grid.innerHTML = '';
  grid.appendChild(criarCardInfra('AdGuard Home', dados.adguard));
  grid.appendChild(criarCardInfra('Tailscale', dados.tailscale));
  if (dados.sistema) {
    grid.appendChild(criarCardInfraInfo('Tempo ligado', dados.sistema.uptime));
    grid.appendChild(criarCardInfraInfo('Espaço em disco', dados.sistema.disco));
  }
}
function criarCardInfra(nome, info) {
  const card = el('div', { class: 'card infra-card' });
  card.appendChild(el('div', { class: `infra-dot ${info.status}` }));
  const body = el('div', { class: 'infra-body' }, [
    el('div', { class: 'infra-nome' }, [nome]),
    el('div', { class: 'infra-detalhe' }, [info.detalhe])
  ]);
  card.appendChild(body);
  return card;
}
function criarCardInfraInfo(nome, valor) {
  const card = el('div', { class: 'card infra-card' });
  card.appendChild(el('div', { class: 'infra-dot not_configured' }));
  const body = el('div', { class: 'infra-body' }, [
    el('div', { class: 'infra-nome' }, [nome]),
    el('div', { class: 'infra-detalhe' }, [valor])
  ]);
  card.appendChild(body);
  return card;
}

// === PASSWORD ===
let senhas = [];
let senhaEditandoId = null;

async function carregarSenhas() {
  const res = await fetch('/api/senhas');
  senhas = await res.json();
  renderizarSenhas();
}
async function salvarSenhas() {
  try {
    const res = await fetch('/api/senhas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(senhas) });
    if (!res.ok) throw new Error();
    mostrarToast('Salvo ✓');
  } catch {
    mostrarToast('Erro ao salvar', true);
  }
}
function renderizarSenhas() {
  const lista = document.getElementById('listaSenhas');
  lista.innerHTML = '';
  if (senhas.length === 0) {
    lista.appendChild(el('p', { style: 'color:var(--muted)' }, ['Nenhuma senha cadastrada.']));
  }
  senhas.forEach(s => lista.appendChild(criarLinhaSenha(s)));
}
function criarLinhaSenha(s) {
  const valorSpan = el('span', { class: 'senha-valor' }, ['••••••••']);
  let visivel = false;
  const btnToggle = el('button', {
    class: 'atalho-seta', type: 'button', title: 'Mostrar/ocultar', html: ICONS.eye,
    onclick: () => {
      visivel = !visivel;
      valorSpan.textContent = visivel ? s.senha : '••••••••';
    }
  });
  const btnCopiar = el('button', {
    class: 'atalho-seta', type: 'button', title: 'Copiar senha', html: ICONS.copy,
    onclick: () => { navigator.clipboard.writeText(s.senha); mostrarToast('Senha copiada'); }
  });
  const btnEditar = el('button', {
    class: 'atalho-seta', type: 'button', title: 'Editar', html: ICONS.pencil,
    onclick: () => abrirModalSenha(s)
  });
  const btnExcluir = el('button', {
    class: 'atalho-seta', type: 'button', title: 'Excluir', html: ICONS.trash,
    onclick: () => {
      if (confirm(`Excluir senha de "${s.site}"?`)) {
        senhas = senhas.filter(x => x.id !== s.id);
        salvarSenhas();
        renderizarSenhas();
      }
    }
  });

  const topoChildren = [el('span', { class: 'senha-site' }, [s.site])];
  if (s.usuario) topoChildren.push(el('span', { class: 'senha-usuario' }, [' · ' + s.usuario]));

  return el('div', { class: 'card senha-linha', title: s.usuario ? `${s.site} · ${s.usuario}` : s.site }, [
    el('div', { class: 'senha-topo' }, topoChildren),
    el('div', { class: 'senha-valor-linha' }, [valorSpan, btnToggle, btnCopiar, btnEditar, btnExcluir])
  ]);
}
const modalSenha = document.getElementById('modalSenha');
document.getElementById('btnNovaSenha').addEventListener('click', () => abrirModalSenha(null));
document.getElementById('btnCancelarSenha').addEventListener('click', () => modalSenha.classList.add('hidden'));
function abrirModalSenha(s) {
  senhaEditandoId = s ? s.id : null;
  document.getElementById('modalSenhaTitulo').textContent = s ? 'Editar senha' : 'Nova senha';
  document.getElementById('campoSenhaSite').value = s ? s.site : '';
  document.getElementById('campoSenhaUsuario').value = s ? (s.usuario || '') : '';
  document.getElementById('campoSenhaValor').value = s ? s.senha : '';
  document.getElementById('campoSenhaNotas').value = s ? (s.notas || '') : '';
  modalSenha.classList.remove('hidden');
  setTimeout(() => document.getElementById('campoSenhaSite').focus(), 50);
}
document.getElementById('formSenha').addEventListener('submit', (e) => {
  e.preventDefault();
  const dados = {
    site: document.getElementById('campoSenhaSite').value.trim(),
    usuario: document.getElementById('campoSenhaUsuario').value.trim(),
    senha: document.getElementById('campoSenhaValor').value,
    notas: document.getElementById('campoSenhaNotas').value.trim()
  };
  if (senhaEditandoId) {
    const s = senhas.find(x => x.id === senhaEditandoId);
    Object.assign(s, dados);
  } else {
    const novoId = senhas.length ? Math.max(...senhas.map(x => x.id)) + 1 : 1;
    senhas.push({ id: novoId, ...dados });
  }
  salvarSenhas();
  renderizarSenhas();
  modalSenha.classList.add('hidden');
  e.target.reset();
});

// === ATALHOS ===
async function carregarAtalhos() {
  const res = await fetch('/api/atalhos');
  atalhos = await res.json();
  renderizarAtalhos();
}
async function salvarAtalhos() {
  try {
    const res = await fetch('/api/atalhos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(atalhos) });
    if (!res.ok) throw new Error();
    mostrarToast('Salvo ✓');
  } catch {
    mostrarToast('Erro ao salvar', true);
  }
}
function renderizarAtalhos() {
  const grid = document.getElementById('gridAtalhos');
  grid.innerHTML = '';
  atalhos.forEach((a, idx) => {
    const link = el('a', { class: 'atalho-link', href: a.url, target: '_blank', rel: 'noopener' }, [
      el('div', { class: 'atalho-icone' }, [a.nome.slice(0, 1).toUpperCase()]),
      el('div', { class: 'atalho-nome', title: a.nome }, [a.nome])
    ]);
    const setas = el('div', { class: 'atalho-setas' }, [
      el('button', {
        class: 'atalho-seta', type: 'button', title: 'Editar', html: ICONS.pencil,
        onclick: () => abrirModalAtalho(a)
      }),
      el('button', {
        class: 'atalho-seta', type: 'button', title: 'Mover para trás',
        onclick: () => moverAtalho(idx, -1)
      }, ['◀']),
      el('button', {
        class: 'atalho-seta', type: 'button', title: 'Mover para frente',
        onclick: () => moverAtalho(idx, 1)
      }, ['▶'])
    ]);
    const card = el('div', { class: 'card atalho-card' }, [link, setas]);
    card.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (confirm(`Remover atalho "${a.nome}"?`)) {
        atalhos = atalhos.filter(x => x.id !== a.id);
        salvarAtalhos();
        renderizarAtalhos();
      }
    });
    grid.appendChild(card);
  });
  grid.appendChild(el('div', { class: 'card atalho-card-novo', onclick: () => abrirModalAtalho(null) }, [
    el('div', { class: 'atalho-icone' }, ['+']),
    el('div', {}, ['Novo'])
  ]));
}
function moverAtalho(idx, direcao) {
  const novoIdx = idx + direcao;
  if (novoIdx < 0 || novoIdx >= atalhos.length) return;
  [atalhos[idx], atalhos[novoIdx]] = [atalhos[novoIdx], atalhos[idx]];
  salvarAtalhos();
  renderizarAtalhos();
}
const modalAtalho = document.getElementById('modalAtalho');
let atalhoEditandoId = null;
function abrirModalAtalho(a) {
  atalhoEditandoId = a ? a.id : null;
  document.getElementById('modalAtalhoTitulo').textContent = a ? 'Editar atalho' : 'Novo atalho';
  document.getElementById('campoAtalhoNome').value = a ? a.nome : '';
  document.getElementById('campoAtalhoUrl').value = a ? a.url : '';
  modalAtalho.classList.remove('hidden');
  setTimeout(() => document.getElementById('campoAtalhoNome').focus(), 50);
}
document.getElementById('btnCancelarAtalho').addEventListener('click', () => modalAtalho.classList.add('hidden'));
document.getElementById('formAtalho').addEventListener('submit', (e) => {
  e.preventDefault();
  let url = document.getElementById('campoAtalhoUrl').value.trim();
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  const nome = document.getElementById('campoAtalhoNome').value.trim();
  if (atalhoEditandoId) {
    const a = atalhos.find(x => x.id === atalhoEditandoId);
    a.nome = nome;
    a.url = url;
  } else {
    const novoId = atalhos.length ? Math.max(...atalhos.map(x => x.id)) + 1 : 1;
    atalhos.push({ id: novoId, nome, url });
  }
  salvarAtalhos();
  renderizarAtalhos();
  modalAtalho.classList.add('hidden');
  e.target.reset();
});

// === INIT ===
carregarAtalhos();
carregarSenhas();
carregarInfra();
carregarProjetos();
