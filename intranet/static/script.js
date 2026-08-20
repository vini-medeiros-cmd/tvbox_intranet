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

// === ABAS ===
const VIEWS = { inicio: 'viewInicio', projetos: 'viewProjetos', prospeccao: 'viewProspeccao', financas: 'viewFinancas', vagas: 'viewVagas' };
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    btn.classList.add('active');
    document.getElementById(VIEWS[btn.dataset.view]).classList.remove('hidden');
  });
});

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
  children.forEach(c => node.appendChild(c instanceof Node ? c : document.createTextNode(String(c))));
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
function formatarDataPlanilha(valor) {
  if (!valor) return '';
  const d = new Date(valor);
  if (isNaN(d.getTime()) || typeof valor !== 'string' || !valor.includes('-')) return valor;
  return d.toLocaleDateString('pt-BR');
}
const NOMES_MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
function normalizarMesAno(valor) {
  if (typeof valor !== 'string' || !valor.includes('T')) return valor;
  const d = new Date(valor);
  if (isNaN(d.getTime())) return valor;
  return `${NOMES_MESES[d.getUTCMonth()]}/${d.getUTCFullYear()}`;
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

// === AGENDA DA SEMANA ===
let agenda = [];
let agendaEditandoId = null;
const DIAS_SEMANA = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];
async function carregarAgenda() {
  const res = await fetch('/api/agenda');
  agenda = await res.json();
  renderizarAgenda();
}
async function salvarAgenda() {
  try {
    const res = await fetch('/api/agenda', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(agenda) });
    if (!res.ok) throw new Error();
    mostrarToast('Salvo ✓');
  } catch {
    mostrarToast('Erro ao salvar', true);
  }
}
function renderizarAgenda() {
  const grid = document.getElementById('gridAgenda');
  grid.innerHTML = '';
  DIAS_SEMANA.forEach(dia => grid.appendChild(criarColunaAgenda(dia)));
}
function criarColunaAgenda(dia) {
  const itens = agenda.filter(a => a.dia === dia).sort((a, b) => (a.hora || '').localeCompare(b.hora || ''));
  const lista = el('div', { class: 'agenda-lista' });
  if (itens.length === 0) {
    lista.appendChild(el('div', { class: 'agenda-vazio' }, ['—']));
  } else {
    itens.forEach(a => lista.appendChild(criarItemAgenda(a)));
  }
  const btnEditarDia = el('button', {
    class: 'agenda-dia-editar', type: 'button', title: 'Editar compromissos do dia', html: ICONS.pencil,
    onclick: () => abrirModalAgendaDia(dia)
  });
  const titulo = el('div', { class: 'agenda-dia-titulo' }, [
    el('span', {}, [dia]),
    btnEditarDia
  ]);
  return el('div', { class: 'agenda-dia' }, [titulo, lista]);
}
function criarItemAgenda(a) {
  const filhos = [];
  if (a.hora) filhos.push(el('span', { class: 'agenda-item-hora' }, [a.hora]));
  filhos.push(el('span', {}, [a.texto]));
  return el('div', { class: 'agenda-item' }, filhos);
}

// Painel "editar dia": lista todos os compromissos de um dia com editar/excluir
let diaAtualEditando = null;
const modalAgendaDia = document.getElementById('modalAgendaDia');
function abrirModalAgendaDia(dia) {
  diaAtualEditando = dia;
  document.getElementById('modalAgendaDiaTitulo').textContent = dia;
  renderizarListaAgendaDia();
  modalAgendaDia.classList.remove('hidden');
}
function renderizarListaAgendaDia() {
  const lista = document.getElementById('listaAgendaDiaEdicao');
  lista.innerHTML = '';
  const itens = agenda.filter(a => a.dia === diaAtualEditando).sort((a, b) => (a.hora || '').localeCompare(b.hora || ''));
  if (itens.length === 0) {
    lista.appendChild(criarEmptyState('Nenhum compromisso nesse dia.'));
    return;
  }
  itens.forEach(a => {
    const btnEditar = el('button', {
      class: 'atalho-seta', type: 'button', title: 'Editar', html: ICONS.pencil,
      onclick: () => { modalAgendaDia.classList.add('hidden'); abrirModalAgenda(a); }
    });
    const btnExcluir = el('button', {
      class: 'atalho-seta', type: 'button', title: 'Excluir', html: ICONS.trash,
      onclick: () => {
        if (confirm(`Excluir "${a.texto}"?`)) {
          agenda = agenda.filter(x => x.id !== a.id);
          salvarAgenda();
          renderizarAgenda();
          renderizarListaAgendaDia();
        }
      }
    });
    const textoFilhos = [];
    if (a.hora) textoFilhos.push(el('span', { class: 'agenda-item-hora' }, [a.hora + ' ']));
    textoFilhos.push(el('span', {}, [a.texto]));
    lista.appendChild(el('div', { class: 'agenda-dia-linha' }, [
      el('div', { class: 'agenda-dia-linha-texto' }, textoFilhos),
      el('div', { class: 'projeto-acoes' }, [btnEditar, btnExcluir])
    ]));
  });
}
document.getElementById('btnFecharAgendaDia').addEventListener('click', () => modalAgendaDia.classList.add('hidden'));
document.getElementById('btnNovoAgendaDia').addEventListener('click', () => {
  modalAgendaDia.classList.add('hidden');
  abrirModalAgenda(null, diaAtualEditando);
});

// Modal de compromisso individual (criar/editar)
const modalAgenda = document.getElementById('modalAgenda');
const btnExcluirAgenda = document.getElementById('btnExcluirAgenda');
function fecharModalAgenda() {
  modalAgenda.classList.add('hidden');
  if (diaAtualEditando) abrirModalAgendaDia(diaAtualEditando);
}
document.getElementById('btnCancelarAgenda').addEventListener('click', fecharModalAgenda);
btnExcluirAgenda.addEventListener('click', () => {
  const a = agenda.find(x => x.id === agendaEditandoId);
  if (a && confirm(`Excluir "${a.texto}"?`)) {
    agenda = agenda.filter(x => x.id !== a.id);
    salvarAgenda();
    renderizarAgenda();
    fecharModalAgenda();
  }
});
function abrirModalAgenda(a, diaPreset) {
  agendaEditandoId = a ? a.id : null;
  document.getElementById('modalAgendaTitulo').textContent = a ? 'Editar compromisso' : 'Novo compromisso';
  document.getElementById('campoAgendaDia').value = a ? a.dia : (diaPreset || 'Segunda');
  document.getElementById('campoAgendaHora').value = a ? (a.hora || '') : '';
  document.getElementById('campoAgendaTexto').value = a ? a.texto : '';
  btnExcluirAgenda.classList.toggle('hidden', !a);
  modalAgenda.classList.remove('hidden');
  setTimeout(() => document.getElementById('campoAgendaTexto').focus(), 50);
}
document.getElementById('formAgenda').addEventListener('submit', (e) => {
  e.preventDefault();
  const dados = {
    dia: document.getElementById('campoAgendaDia').value,
    hora: document.getElementById('campoAgendaHora').value.trim(),
    texto: document.getElementById('campoAgendaTexto').value.trim()
  };
  if (agendaEditandoId) {
    const a = agenda.find(x => x.id === agendaEditandoId);
    Object.assign(a, dados);
  } else {
    const novoId = agenda.length ? Math.max(...agenda.map(x => x.id)) + 1 : 1;
    agenda.push({ id: novoId, ...dados });
  }
  salvarAgenda();
  renderizarAgenda();
  e.target.reset();
  fecharModalAgenda();
});

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
      el('div', { class: 'atalho-nome', title: a.nome }, [a.nome])
    ]);
    const setas = el('div', { class: 'atalho-setas' }, [
      el('button', {
        class: 'atalho-seta', type: 'button', title: 'Mover para trás',
        onclick: () => moverAtalho(idx, -1)
      }, ['◀']),
      el('button', {
        class: 'atalho-seta', type: 'button', title: 'Mover para frente',
        onclick: () => moverAtalho(idx, 1)
      }, ['▶'])
    ]);
    const acoes = el('div', { class: 'atalho-acoes' }, [
      el('button', {
        class: 'atalho-seta', type: 'button', title: 'Editar', html: ICONS.pencil,
        onclick: () => abrirModalAtalho(a)
      }),
      el('button', {
        class: 'atalho-seta', type: 'button', title: 'Excluir', html: ICONS.trash,
        onclick: () => {
          if (confirm(`Remover atalho "${a.nome}"?`)) {
            atalhos = atalhos.filter(x => x.id !== a.id);
            salvarAtalhos();
            renderizarAtalhos();
          }
        }
      })
    ]);
    const card = el('div', { class: 'card atalho-card' }, [link, setas, acoes]);
    grid.appendChild(card);
  });
  grid.appendChild(el('div', { class: 'card atalho-card-novo', onclick: () => abrirModalAtalho(null) }, [
    el('div', {}, ['+ Novo'])
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

// ===================== CONTROLE FINANCEIRO =====================
let financas = [];
let lancEditandoLinha = null;

async function carregarFinancas() {
  const lista = document.getElementById('listaFinancas');
  const res = await fetch('/api/financas');
  const dados = await res.json();
  if (dados && dados.erro) {
    lista.innerHTML = '';
    lista.appendChild(criarEmptyState('Erro: ' + dados.erro));
    return;
  }
  financas = dados.map(f => ({ ...f, 'Mes/Ano': normalizarMesAno(f['Mes/Ano']) }));
  popularSelectMeses();
  document.getElementById('listaCategorias').innerHTML =
    [...new Set(financas.map(f => f['Categoria']).filter(Boolean))].map(c => `<option value="${c}">`).join('');
  renderizarFinancas();
}
function popularSelectMeses() {
  const select = document.getElementById('filtroMesFinancas');
  const atual = select.value;
  const meses = [...new Set(financas.map(f => f['Mes/Ano']).filter(Boolean))];
  select.innerHTML = '<option value="todos">Todos os meses</option>' + meses.map(m => `<option value="${m}">${m}</option>`).join('');
  select.value = atual || 'todos';
}
async function salvarLancamento(dados, linha) {
  try {
    const body = linha ? { action: 'update', dados, _linha: linha } : { action: 'append', dados };
    const res = await fetch('/api/financas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const resultado = await res.json();
    if (resultado.erro) throw new Error(resultado.erro);
    mostrarToast('Salvo ✓');
    carregarFinancas();
  } catch (e) {
    mostrarToast('Erro ao salvar: ' + e.message, true);
  }
}
async function excluirLancamento(f) {
  if (!confirm(`Excluir o lançamento "${f['Descricao'] || ''}"?`)) return;
  try {
    const res = await fetch('/api/financas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', _linha: f._linha }) });
    const resultado = await res.json();
    if (resultado.erro) throw new Error(resultado.erro);
    mostrarToast('Excluído ✓');
    carregarFinancas();
  } catch (e) {
    mostrarToast('Erro ao excluir: ' + e.message, true);
  }
}
function renderizarFinancas() {
  const termo = document.getElementById('filtroFinancas').value.toLowerCase().trim();
  const mes = document.getElementById('filtroMesFinancas').value;
  const filtrados = financas.filter(f =>
    (!termo || (f['Descricao'] || '').toLowerCase().includes(termo)) &&
    (mes === 'todos' || f['Mes/Ano'] === mes)
  );
  const lista = document.getElementById('listaFinancas');
  lista.innerHTML = '';
  if (filtrados.length === 0) {
    lista.appendChild(criarEmptyState('Nenhum lançamento encontrado.'));
    return;
  }
  filtrados.slice().reverse().forEach(f => lista.appendChild(criarLinhaFinanca(f)));
}
function criarLinhaFinanca(f) {
  const btnEditar = el('button', {
    class: 'atalho-seta', type: 'button', title: 'Editar', html: ICONS.pencil,
    onclick: (e) => { e.stopPropagation(); abrirModalLancamento(f); }
  });
  const btnExcluir = el('button', {
    class: 'atalho-seta', type: 'button', title: 'Excluir', html: ICONS.trash,
    onclick: (e) => { e.stopPropagation(); excluirLancamento(f); }
  });
  return el('div', { class: 'tabela-linha', onclick: () => abrirModalLancamento(f) }, [
    el('span', {}, [f['Mes/Ano'] || '']),
    el('span', { title: f['Descricao'] || '' }, [f['Descricao'] || '']),
    el('span', {}, [f['Tipo'] || '']),
    el('span', {}, [f['Categoria'] || '']),
    el('span', { class: 'valor-entrada' }, [f['Entrada (R$)'] || '']),
    el('span', { class: 'valor-saida' }, [f['Saida (R$)'] || '']),
    el('span', { class: 'tabela-acoes' }, [btnEditar, btnExcluir])
  ]);
}
document.getElementById('filtroFinancas').addEventListener('input', renderizarFinancas);
document.getElementById('filtroMesFinancas').addEventListener('change', renderizarFinancas);
const modalLancamento = document.getElementById('modalLancamento');
document.getElementById('btnNovoLancamento').addEventListener('click', () => abrirModalLancamento(null));
document.getElementById('btnCancelarLancamento').addEventListener('click', () => modalLancamento.classList.add('hidden'));
function abrirModalLancamento(f) {
  lancEditandoLinha = f ? f._linha : null;
  document.getElementById('modalLancamentoTitulo').textContent = f ? 'Editar lançamento' : 'Novo lançamento';
  document.getElementById('campoLancMes').value = f ? (f['Mes/Ano'] || '') : '';
  document.getElementById('campoLancDescricao').value = f ? (f['Descricao'] || '') : '';
  document.getElementById('campoLancTipo').value = f ? (f['Tipo'] || 'Despesa') : 'Despesa';
  document.getElementById('campoLancCategoria').value = f ? (f['Categoria'] || '') : '';
  document.getElementById('campoLancEntrada').value = f ? (f['Entrada (R$)'] || '') : '';
  document.getElementById('campoLancSaida').value = f ? (f['Saida (R$)'] || '') : '';
  modalLancamento.classList.remove('hidden');
  setTimeout(() => document.getElementById('campoLancMes').focus(), 50);
}
document.getElementById('formLancamento').addEventListener('submit', (e) => {
  e.preventDefault();
  const dados = {
    'Mes/Ano': document.getElementById('campoLancMes').value.trim(),
    'Descricao': document.getElementById('campoLancDescricao').value.trim(),
    'Tipo': document.getElementById('campoLancTipo').value,
    'Categoria': document.getElementById('campoLancCategoria').value.trim(),
    'Entrada (R$)': document.getElementById('campoLancEntrada').value.trim(),
    'Saida (R$)': document.getElementById('campoLancSaida').value.trim()
  };
  salvarLancamento(dados, lancEditandoLinha);
  modalLancamento.classList.add('hidden');
  e.target.reset();
});

// ===================== GESTAO DE VAGAS =====================
let vagas = [];
let vagaEditandoLinha = null;

function statusClasse(status) {
  const s = (status || '').toLowerCase();
  if (s.includes('rejeit') || s.includes('não selecionado') || s.includes('nao selecionado') || s.includes('não elegível') || s.includes('encerrar')) return 'ruim';
  if (s.includes('aguardando') || s.includes('pendente')) return 'espera';
  if (s.includes('selecionado') || s.includes('aprovado') || s.includes('contratad')) return 'ok';
  return 'neutro';
}
async function carregarVagas() {
  const lista = document.getElementById('listaVagas');
  const res = await fetch('/api/vagas');
  const dados = await res.json();
  if (dados && dados.erro) {
    lista.innerHTML = '';
    lista.appendChild(criarEmptyState('Erro: ' + dados.erro));
    return;
  }
  vagas = dados;
  const usados = vagas.map(v => v['Status']).filter(Boolean);
  let statusList = [...new Set(usados)];
  try {
    const resOpcoes = await fetch('/api/vagas/status-opcoes');
    const opcoes = await resOpcoes.json();
    if (Array.isArray(opcoes) && opcoes.length && opcoes.every(o => typeof o === 'string')) {
      statusList = [...new Set([...opcoes, ...usados])];
    }
  } catch (e) { /* segue só com os status já usados */ }
  const select = document.getElementById('filtroStatusVaga');
  const atual = select.value;
  select.innerHTML = '<option value="todos">Todos os status</option>' + statusList.map(s => `<option value="${s}">${s}</option>`).join('');
  select.value = atual || 'todos';
  document.getElementById('listaCanais').innerHTML =
    [...new Set(vagas.map(v => v['Canal']).filter(Boolean))].map(c => `<option value="${c}">`).join('');
  document.getElementById('listaStatusVaga').innerHTML = statusList.map(s => `<option value="${s}">`).join('');
  renderizarVagas();
}
async function salvarVaga(dados, linha) {
  try {
    const body = linha ? { action: 'update', dados, _linha: linha } : { action: 'append', dados };
    const res = await fetch('/api/vagas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const resultado = await res.json();
    if (resultado.erro) throw new Error(resultado.erro);
    mostrarToast('Salvo ✓');
    carregarVagas();
  } catch (e) {
    mostrarToast('Erro ao salvar: ' + e.message, true);
  }
}
async function excluirVaga(v) {
  if (!confirm(`Excluir a candidatura em "${v['Empresa'] || ''}"?`)) return;
  try {
    const res = await fetch('/api/vagas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', _linha: v._linha }) });
    const resultado = await res.json();
    if (resultado.erro) throw new Error(resultado.erro);
    mostrarToast('Excluído ✓');
    carregarVagas();
  } catch (e) {
    mostrarToast('Erro ao excluir: ' + e.message, true);
  }
}
function renderizarVagas() {
  const termo = document.getElementById('filtroVagas').value.toLowerCase().trim();
  const status = document.getElementById('filtroStatusVaga').value;
  const filtrados = vagas.filter(v =>
    (!termo || (v['Empresa'] || '').toLowerCase().includes(termo) || (v['Vaga'] || '').toLowerCase().includes(termo)) &&
    (status === 'todos' || v['Status'] === status)
  );
  const ordenados = filtrados.slice().sort((a, b) => {
    const da = new Date(a['Candidatura']).getTime();
    const db = new Date(b['Candidatura']).getTime();
    return (isNaN(db) ? -Infinity : db) - (isNaN(da) ? -Infinity : da);
  });
  const contador = document.getElementById('contadorVagas');
  contador.textContent = (termo || status !== 'todos')
    ? `${filtrados.length} de ${vagas.length}`
    : `${vagas.length}`;
  const lista = document.getElementById('listaVagas');
  lista.innerHTML = '';
  if (ordenados.length === 0) {
    lista.appendChild(criarEmptyState('Nenhuma candidatura encontrada.'));
    return;
  }
  ordenados.forEach(v => lista.appendChild(criarLinhaVaga(v)));
}
function criarLinhaVaga(v) {
  const btnEditar = el('button', {
    class: 'atalho-seta', type: 'button', title: 'Editar', html: ICONS.pencil,
    onclick: (e) => { e.stopPropagation(); abrirModalVaga(v); }
  });
  const btnExcluir = el('button', {
    class: 'atalho-seta', type: 'button', title: 'Excluir', html: ICONS.trash,
    onclick: (e) => { e.stopPropagation(); excluirVaga(v); }
  });
  return el('div', { class: 'tabela-linha', onclick: () => abrirModalVaga(v) }, [
    el('span', { title: v['Empresa'] || '' }, [v['Empresa'] || '']),
    el('span', { title: v['Vaga'] || '' }, [v['Vaga'] || '']),
    el('span', {}, [formatarDataPlanilha(v['Candidatura'])]),
    el('span', {}, [v['Canal'] || '']),
    el('span', {}, [
      el('span', { class: `status-dot ${statusClasse(v['Status'])}` }),
      v['Status'] || ''
    ]),
    el('span', { class: 'tabela-acoes' }, [btnEditar, btnExcluir])
  ]);
}
document.getElementById('filtroVagas').addEventListener('input', renderizarVagas);
document.getElementById('filtroStatusVaga').addEventListener('change', renderizarVagas);
const modalVaga = document.getElementById('modalVaga');
document.getElementById('btnNovaVaga').addEventListener('click', () => abrirModalVaga(null));
document.getElementById('btnCancelarVaga').addEventListener('click', () => modalVaga.classList.add('hidden'));
function abrirModalVaga(v) {
  vagaEditandoLinha = v ? v._linha : null;
  document.getElementById('modalVagaTitulo').textContent = v ? 'Editar candidatura' : 'Nova candidatura';
  document.getElementById('campoVagaEmpresa').value = v ? (v['Empresa'] || '') : '';
  document.getElementById('campoVagaTitulo2').value = v ? (v['Vaga'] || '') : '';
  document.getElementById('campoVagaData').value = v ? formatarDataPlanilha(v['Candidatura']) : '';
  document.getElementById('campoVagaCanal').value = v ? (v['Canal'] || '') : '';
  document.getElementById('campoVagaLink').value = v ? (v['Link / Contato'] || '') : '';
  document.getElementById('campoVagaStatus').value = v ? (v['Status'] || 'Aguardando retorno') : 'Aguardando retorno';
  document.getElementById('campoVagaObs').value = v ? (v['Observações'] || '') : '';
  modalVaga.classList.remove('hidden');
  setTimeout(() => document.getElementById('campoVagaEmpresa').focus(), 50);
}
document.getElementById('formVaga').addEventListener('submit', (e) => {
  e.preventDefault();
  const dados = {
    'Empresa': document.getElementById('campoVagaEmpresa').value.trim(),
    'Vaga': document.getElementById('campoVagaTitulo2').value.trim(),
    'Candidatura': document.getElementById('campoVagaData').value.trim(),
    'Canal': document.getElementById('campoVagaCanal').value.trim(),
    'Link / Contato': document.getElementById('campoVagaLink').value.trim(),
    'Status': document.getElementById('campoVagaStatus').value.trim(),
    'Observações': document.getElementById('campoVagaObs').value.trim()
  };
  salvarVaga(dados, vagaEditandoLinha);
  modalVaga.classList.add('hidden');
  e.target.reset();
});

// ===================== PROSPECCAO DE CLIENTES =====================
let prospeccoes = [];
let prospEditandoId = null;
const STATUS_PROSPECCAO_KEY = {
  'Não contatado': 'nao-contatado',
  'Contatado': 'contatado',
  'Em negociação': 'negociacao',
  'Proposta enviada': 'proposta',
  'Fechado': 'fechado',
  'Recusado': 'recusado'
};

async function carregarProspeccao() {
  const res = await fetch('/api/prospeccao');
  prospeccoes = await res.json();
  document.getElementById('listaSegmentos').innerHTML =
    [...new Set(prospeccoes.map(p => p.segmento).filter(Boolean))].map(s => `<option value="${s}">`).join('');
  renderizarProspeccao();
}
async function salvarProspeccao() {
  try {
    const res = await fetch('/api/prospeccao', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(prospeccoes) });
    if (!res.ok) throw new Error();
    mostrarToast('Salvo ✓');
  } catch {
    mostrarToast('Erro ao salvar', true);
  }
}
function renderizarProspeccao() {
  const termo = document.getElementById('filtroProspeccao').value.toLowerCase().trim();
  const status = document.getElementById('filtroStatusProspeccao').value;
  const filtrados = prospeccoes.filter(p =>
    (!termo || (p.empresa || '').toLowerCase().includes(termo) || (p.segmento || '').toLowerCase().includes(termo) || (p.cidade || '').toLowerCase().includes(termo)) &&
    (status === 'todos' || p.status === status)
  );
  const grid = document.getElementById('gridProspeccao');
  grid.innerHTML = '';
  if (filtrados.length === 0) {
    grid.appendChild(criarEmptyState('Nenhuma prospecção encontrada.'));
    return;
  }
  filtrados.forEach(p => grid.appendChild(criarCardProspeccao(p)));
}
function criarDetalhesProspeccao(p) {
  const detalhes = el('div', { class: 'prospeccao-detalhes hidden' });
  detalhes.appendChild(el('div', { class: 'projeto-desc' }, [`Site: ${p.temSite || 'Não'} · Instagram/GMN: ${p.temInstagram || 'Não'}`]));
  if (p.link) {
    let url = p.link.trim();
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    detalhes.appendChild(el('a', { class: 'projeto-link', href: url, target: '_blank', rel: 'noopener' }, [
      el('span', { html: ICONS.link, class: 'icone-inline' }), 'Abrir link'
    ]));
  }
  const contato = [p.whatsapp, p.email].filter(Boolean).join(' · ');
  if (contato) detalhes.appendChild(el('div', { class: 'projeto-meta' }, [contato]));
  if (p.dataContato) detalhes.appendChild(el('div', { class: 'projeto-meta' }, [`1º contato: ${p.dataContato}`]));
  if (p.observacoes) detalhes.appendChild(el('div', { class: 'projeto-desc' }, [p.observacoes]));
  return detalhes;
}
function criarToggleDetalhes(detalhes) {
  const toggle = el('div', { class: 'prospeccao-toggle' }, ['Ver detalhes ▾']);
  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    const aberto = detalhes.classList.toggle('hidden');
    toggle.textContent = aberto ? 'Ver detalhes ▾' : 'Ocultar detalhes ▴';
  });
  return toggle;
}
function criarCardProspeccao(p) {
  const key = STATUS_PROSPECCAO_KEY[p.status] || 'nao-contatado';
  const card = el('div', { class: 'card projeto-card prospeccao-card', 'data-status': key });

  card.appendChild(el('div', { class: 'projeto-topo' }, [
    el('div', { class: 'projeto-nome' }, [p.empresa || '']),
    el('span', { class: `badge badge-prospeccao-${key}` }, [p.status || ''])
  ]));
  card.appendChild(el('div', { class: 'projeto-prazo' }, [`${p.segmento || '—'} · ${p.cidade || '—'}`]));

  const detalhes = criarDetalhesProspeccao(p);
  card.appendChild(criarToggleDetalhes(detalhes));
  card.appendChild(detalhes);

  const btnEditar = el('button', {
    class: 'atalho-seta', type: 'button', title: 'Editar', html: ICONS.pencil,
    onclick: () => abrirModalProspeccao(p)
  });
  const btnExcluir = el('button', {
    class: 'atalho-seta', type: 'button', title: 'Excluir', html: ICONS.trash,
    onclick: () => {
      if (confirm(`Excluir a prospecção de "${p.empresa}"?`)) {
        prospeccoes = prospeccoes.filter(x => x.id !== p.id);
        salvarProspeccao();
        renderizarProspeccao();
      }
    }
  });
  card.appendChild(el('div', { class: 'projeto-acoes' }, [btnEditar, btnExcluir]));

  return card;
}
document.getElementById('filtroProspeccao').addEventListener('input', renderizarProspeccao);
document.getElementById('filtroStatusProspeccao').addEventListener('change', renderizarProspeccao);

const modalProspeccao = document.getElementById('modalProspeccao');
document.getElementById('btnNovaProspeccao').addEventListener('click', () => abrirModalProspeccao(null));
document.getElementById('btnCancelarProspeccao').addEventListener('click', () => modalProspeccao.classList.add('hidden'));
function abrirModalProspeccao(p) {
  prospEditandoId = p ? p.id : null;
  document.getElementById('modalProspeccaoTitulo').textContent = p ? 'Editar prospecção' : 'Nova prospecção';
  document.getElementById('campoProspEmpresa').value = p ? (p.empresa || '') : '';
  document.getElementById('campoProspSegmento').value = p ? (p.segmento || '') : '';
  document.getElementById('campoProspCidade').value = p ? (p.cidade || '') : '';
  document.getElementById('campoProspSite').value = p ? (p.temSite || 'Não') : 'Não';
  document.getElementById('campoProspInsta').value = p ? (p.temInstagram || 'Não') : 'Não';
  document.getElementById('campoProspLink').value = p ? (p.link || '') : '';
  document.getElementById('campoProspWhatsapp').value = p ? (p.whatsapp || '') : '';
  document.getElementById('campoProspEmail').value = p ? (p.email || '') : '';
  document.getElementById('campoProspStatus').value = p ? (p.status || 'Não contatado') : 'Não contatado';
  document.getElementById('campoProspData').value = p ? (p.dataContato || '') : '';
  document.getElementById('campoProspObs').value = p ? (p.observacoes || '') : '';
  modalProspeccao.classList.remove('hidden');
  setTimeout(() => document.getElementById('campoProspEmpresa').focus(), 50);
}
document.getElementById('formProspeccao').addEventListener('submit', (e) => {
  e.preventDefault();
  const dados = {
    empresa: document.getElementById('campoProspEmpresa').value.trim(),
    segmento: document.getElementById('campoProspSegmento').value.trim(),
    cidade: document.getElementById('campoProspCidade').value.trim(),
    temSite: document.getElementById('campoProspSite').value,
    temInstagram: document.getElementById('campoProspInsta').value,
    link: document.getElementById('campoProspLink').value.trim(),
    whatsapp: document.getElementById('campoProspWhatsapp').value.trim(),
    email: document.getElementById('campoProspEmail').value.trim(),
    status: document.getElementById('campoProspStatus').value,
    dataContato: document.getElementById('campoProspData').value.trim(),
    observacoes: document.getElementById('campoProspObs').value.trim()
  };
  if (prospEditandoId) {
    const p = prospeccoes.find(x => x.id === prospEditandoId);
    Object.assign(p, dados);
  } else {
    const novoId = prospeccoes.length ? Math.max(...prospeccoes.map(x => x.id)) + 1 : 1;
    prospeccoes.push({ id: novoId, ...dados });
  }
  salvarProspeccao();
  renderizarProspeccao();
  modalProspeccao.classList.add('hidden');
  e.target.reset();
});

// === SEÇÕES RECOLHÍVEIS (Início) ===
function configurarSecaoRecolhivel(idTitulo, idCorpo) {
  const titulo = document.getElementById(idTitulo);
  const corpo = document.getElementById(idCorpo);
  const seta = titulo.querySelector('.secao-seta');
  const chave = `secaoRecolhida:${idCorpo}`;
  const aplicar = (recolhida) => {
    corpo.classList.toggle('hidden', recolhida);
    seta.classList.toggle('recolhida', recolhida);
  };
  aplicar(localStorage.getItem(chave) === '1');
  titulo.addEventListener('click', () => {
    const recolhida = !corpo.classList.contains('hidden');
    aplicar(recolhida);
    localStorage.setItem(chave, recolhida ? '1' : '0');
  });
}
configurarSecaoRecolhivel('tituloAgenda', 'corpoAgenda');
configurarSecaoRecolhivel('tituloAtalhos', 'corpoAtalhos');
configurarSecaoRecolhivel('tituloSenhas', 'corpoSenhas');
configurarSecaoRecolhivel('tituloInfra', 'corpoInfra');

// === INIT ===
carregarAgenda();
carregarAtalhos();
carregarSenhas();
carregarInfra();
carregarProjetos();
carregarProspeccao();
// carregarFinancas(); — aba oculta a pedido do usuário, gestão feita direto na planilha
carregarVagas();
