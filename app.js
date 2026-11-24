// =========================================================================
// FRONTEND - MANUTENÇÃO PREDIAL
// =========================================================================
const API_URL = 'https://script.google.com/macros/s/AKfycbxY3JojVBG2XrhXJlbbV3cijVB19AdfuTgPv8U1668DwIFoofR-YR-4aiXKSVeneLhI/exec';

let usuarioAdmin = null;
let tokenAdmin = null;
let todasOS = [];
let osAbertaNoModal = null;
let subTarefasAtuais = [];
let estado = { filtroBusca: '', filtroStatusDash: null, ordenacaoAtiva: 'DATA', direcaoOrdenacao: -1 };

// Controle de estado de uploads e requisições individuais
let arquivosNovaOS = [];
let arquivoUnicoParaUpload = null;
let tipoUploadAnexoAtual = 'ARQUIVO';
let origemFotoUploadAtual = 'GALERIA';
let contextoEscolhaFoto = 'CRIACAO';
let processandoArquivosCount = 0;

// Locks individuais por ação/formulário
let salvandoOS = false;
let salvandoSubtarefa = false;
let salvandoEdicaoSub = false;
let salvandoComentario = false;
let enviandoAnexo = false;

// Mapa de estados de carregamento por OS individual (chave: `${idOS}:${acao}`)
const osActionLoading = {};

function setOsLoading(idOS, acao, isLoading) {
  if (!idOS) return;
  const key = `${idOS}:${acao}`;
  if (isLoading) osActionLoading[key] = true;
  else delete osActionLoading[key];
}

function isOsLoading(idOS, acao) {
  return !!(idOS && osActionLoading[`${idOS}:${acao}`]);
}

function limparEstadosDaOS(idOS) {
  if (!idOS) return;
  Object.keys(osActionLoading).forEach(k => {
    if (k.startsWith(`${idOS}:`)) delete osActionLoading[k];
  });
}

// =========================================================================
// WRAPPER DE COMUNICAÇÃO COM O APPS SCRIPT
// =========================================================================
async function apiCall(action, payload = {}) {
  if (tokenAdmin) payload.token = tokenAdmin;
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ action: action, payload: payload })
  });
  return await res.json();
}

// =========================================================================
// FORMATAÇÃO BLINDADA DE DATAS (DD/MM/AAAA)
// =========================================================================
function formatarDataBR(valor) {
  if (valor === null || valor === undefined || valor === '') return '';
  const str = String(valor).trim();
  if (!str || str === 'Não informada') return str;

  if (/^\d{2}\/\d{2}\/\d{4}$/.test(str)) return str;

  const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
  }

  const corruptMatch = str.match(/^(\d{2})T[^/]+\/(\d{2})\/(\d{4})$/);
  if (corruptMatch) {
    return `${corruptMatch[1]}/${corruptMatch[2]}/${corruptMatch[3]}`;
  }

  return str;
}

function converterBRParaInputDate(dataBR) {
  const limpa = formatarDataBR(dataBR);
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(limpa)) {
    const [d, m, a] = limpa.split('/');
    return `${a}-${m}-${d}`;
  }
  return '';
}

// =========================================================================
// CONTROLE SEGURO DE TODOS OS MODAIS (BOTÃO X, CANCELAR E OVERLAY)
// =========================================================================
function atualizarScrollBody() {
  const algumAberto = Array.from(document.querySelectorAll('.modal-overlay')).some(m => m.classList.contains('active'));
  document.body.classList.toggle('modal-open', algumAberto);
}

function fecharModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.remove('active');

  if (modalId === 'modal-nova-os') {
    limparEstadoNovaOS();
  } else if (modalId === 'modal-upload-anexo') {
    limparEstadoUploadAnexo();
  } else if (modalId === 'modal-comentario-sub') {
    document.getElementById('texto-comentario-sub').value = '';
    document.getElementById('comentario-item-id').value = '';
  }

  atualizarScrollBody();
}

function fecharAoClicarFora(event, modalId) {
  if (event.target && event.target.id === modalId) {
    if (modalId === 'modal-nova-os' && salvandoOS) return;
    if (modalId === 'modal-upload-anexo' && enviandoAnexo) return;
    fecharModal(modalId);
  }
}

function fecharTodosModais() {
  salvandoOS = false;
  enviandoAnexo = false;
  document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
  limparEstadoNovaOS();
  limparEstadoUploadAnexo();
  atualizarScrollBody();
}

function limparEstadoNovaOS() {
  arquivosNovaOS = [];
  processandoArquivosCount = 0;
  atualizarStatusProcessamentoCriacao();
  const preview = document.getElementById('preview-arquivos-criacao');
  if (preview) preview.innerHTML = '';
  ['input-foto-criacao-camera', 'input-foto-criacao-galeria', 'nova-os-arquivo'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
}

function limparEstadoUploadAnexo() {
  arquivoUnicoParaUpload = null;
  ['input-anexo-os', 'input-foto-detalhes-camera', 'input-foto-detalhes-galeria'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const prevUnico = document.getElementById('preview-anexo-unico');
  if (prevUnico) prevUnico.innerHTML = '';
}

// =========================================================================
// AUTENTICAÇÃO E AJUSTE DE TECLADO MOBILE NO LOGIN
// =========================================================================
function abrirModalLogin() {
  document.getElementById('login-form').reset();
  document.getElementById('login-msg').style.display = 'none';
  const overlay = document.getElementById('modal-login');
  overlay.classList.add('active');
  overlay.scrollTop = 0;
  atualizarScrollBody();
  ajustarViewportLoginMobile();
}

function ajustarViewportLoginMobile() {
  const overlay = document.getElementById('modal-login');
  if (!overlay || !overlay.classList.contains('active')) return;
  if (window.visualViewport) {
    overlay.style.height = window.visualViewport.height + 'px';
  }
}

if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', ajustarViewportLoginMobile);
  window.visualViewport.addEventListener('scroll', ajustarViewportLoginMobile);
}

['username', 'password'].forEach(id => {
  const input = document.getElementById(id);
  if (input) {
    input.addEventListener('focus', () => {
      setTimeout(() => {
        ajustarViewportLoginMobile();
        const btnLogin = document.getElementById('btn-login');
        if (btnLogin) {
          btnLogin.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }, 250);
    });
  }
});

function verificarSessao() {
  const t = localStorage.getItem('manutencao_token');
  const u = localStorage.getItem('manutencao_user');
  if (t && u) {
    tokenAdmin = t;
    usuarioAdmin = JSON.parse(u);
    document.body.classList.add('is-admin');
    document.getElementById('btn-login-modal').style.display = 'none';
    document.getElementById('user-profile').style.display = 'flex';
    document.getElementById('user-info-nome').textContent = usuarioAdmin.nome;
  } else {
    fazerLogout(false);
  }
  carregarDadosAPI();
}

function fazerLogout(refresh = true) {
  localStorage.removeItem('manutencao_token');
  localStorage.removeItem('manutencao_user');
  tokenAdmin = null;
  usuarioAdmin = null;
  document.body.classList.remove('is-admin');
  document.getElementById('btn-login-modal').style.display = 'inline-flex';
  document.getElementById('user-profile').style.display = 'none';
  if (refresh) {
    fecharTodosModais();
    carregarDadosAPI();
  }
}

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('btn-login');
  const msgBox = document.getElementById('login-msg');
  msgBox.style.display = 'none';
  btn.innerHTML = '<span class="material-symbols-outlined spinning-icon">sync</span> Validando...';
  btn.disabled = true;

  try {
    const dados = await apiCall('login', {
      usuario: document.getElementById('username').value.trim(),
      senha: document.getElementById('password').value.trim()
    });
    if (dados.status === 'sucesso') {
      localStorage.setItem('manutencao_token', dados.token);
      localStorage.setItem('manutencao_user', JSON.stringify(dados.usuario));
      fecharModal('modal-login');
      verificarSessao();
    } else {
      msgBox.style.display = 'block';
      msgBox.textContent = dados.mensagem || 'Credenciais inválidas.';
    }
  } catch (erro) {
    msgBox.style.display = 'block';
    msgBox.textContent = 'Erro de conexão com o servidor.';
  } finally {
    btn.innerHTML = '<span class="material-symbols-outlined">login</span> Entrar';
    btn.disabled = false;
  }
});

// =========================================================================
// LISTAGEM, DASHBOARD, BUSCA E FILTROS
// =========================================================================
async function carregarDadosAPI() {
  document.getElementById('os-container').innerHTML = '<div class="loading-state"><div class="spinner"></div>Buscando solicitações...</div>';
  try {
    const [respDash, respOS] = await Promise.all([apiCall('getDashboard'), apiCall('getOS')]);
    if (respDash.status === 'sucesso') {
      document.getElementById('count-aberto').textContent = respDash.dashboard.naoIniciado;
      document.getElementById('count-pecas').textContent = respDash.dashboard.aguardandoPecas;
      document.getElementById('count-andamento').textContent = respDash.dashboard.emAndamento;
      document.getElementById('count-concluido').textContent = respDash.dashboard.concluido;
    }
    if (respOS.status === 'sucesso') {
      todasOS = respOS.dados;
      aplicarFiltrosEOrdenacao();
    } else if (respOS.mensagem && respOS.mensagem.includes('Acesso negado')) {
      fazerLogout();
    }
  } catch (erro) {
    document.getElementById('os-container').innerHTML = '<div class="loading-state">Erro ao carregar dados do servidor.</div>';
  }
}

function alternarFiltro(status, el) {
  if (estado.filtroStatusDash === status) {
    estado.filtroStatusDash = null;
    el.classList.remove('active');
    document.getElementById('btn-todas').classList.add('active-all');
  } else {
    document.querySelectorAll('.dash-card').forEach(c => c.classList.remove('active'));
    estado.filtroStatusDash = status;
    el.classList.add('active');
    document.getElementById('btn-todas').classList.remove('active-all');
  }
  aplicarFiltrosEOrdenacao();
}

function limparFiltros() {
  estado.filtroStatusDash = null;
  estado.filtroBusca = '';
  document.getElementById('search-os').value = '';
  document.querySelectorAll('.dash-card').forEach(c => c.classList.remove('active'));
  document.getElementById('btn-todas').classList.add('active-all');
  aplicarFiltrosEOrdenacao();
}

document.getElementById('botoes-ordenacao').addEventListener('click', (e) => {
  const btn = e.target.closest('.chip');
  if (!btn || btn.id === 'btn-todas') return;
  const tipo = btn.getAttribute('data-ordem');
  if (estado.ordenacaoAtiva === tipo) estado.direcaoOrdenacao *= -1;
  else { estado.ordenacaoAtiva = tipo; estado.direcaoOrdenacao = -1; }

  document.querySelectorAll('.chip').forEach(c => {
    if (c.hasAttribute('data-ordem')) {
      c.classList.remove('active');
      c.querySelector('.sort-icon').style.opacity = '0';
    }
  });
  btn.classList.add('active');
  const ic = btn.querySelector('.sort-icon');
  ic.style.opacity = '1';
  ic.textContent = estado.direcaoOrdenacao === -1 ? 'arrow_downward' : 'arrow_upward';
  aplicarFiltrosEOrdenacao();
});

document.getElementById('search-os').addEventListener('input', (e) => {
  estado.filtroBusca = removerAcentos(e.target.value.toLowerCase().trim());
  aplicarFiltrosEOrdenacao();
});

function removerAcentos(str) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function aplicarFiltrosEOrdenacao() {
  let filtrada = [...todasOS];
  if (estado.filtroStatusDash) {
    if (estado.filtroStatusDash === 'EM ABERTO') {
      filtrada = filtrada.filter(o => String(o.status).toUpperCase().includes('ABERTO') || String(o.status).toUpperCase().includes('NÃO INICIADO'));
    } else if (estado.filtroStatusDash === 'AGUARDANDO') {
      filtrada = filtrada.filter(o => {
        const s = String(o.status).toUpperCase();
        return s.includes('PEÇAS') || s.includes('PECAS') || s.includes('MATERIAL');
      });
    } else {
      filtrada = filtrada.filter(o => String(o.status).toUpperCase().includes(estado.filtroStatusDash));
    }
  }

  if (estado.filtroBusca) {
    const termos = estado.filtroBusca.split(' ');
    filtrada = filtrada.filter(o => {
      const txt = `${o.id} ${o.matricula} ${o.descricao} ${o.setor} ${o.solicitante} ${o.status} ${o.prioridade}`;
      const nTxt = removerAcentos(txt.toLowerCase());
      return termos.every(t => nTxt.includes(t));
    });
  }

  filtrada.sort((a, b) => {
    let vA, vB;
    if (estado.ordenacaoAtiva === 'PRIORIDADE') {
      const peso = p => (p || '').includes('Urgente') ? 4 : (p || '').includes('Alta') ? 3 : (p || '').includes('Média') ? 2 : 1;
      vA = peso(a.prioridade);
      vB = peso(b.prioridade);
    } else if (estado.ordenacaoAtiva === 'PROGRESSO') {
      vA = parseFloat(a.progresso) || 0;
      vB = parseFloat(b.progresso) || 0;
    } else {
      const parseId = id => {
        const p = String(id || '0.0').split('.');
        return (parseInt(p[1], 10) || 0) * 100000 + (parseInt(p[0], 10) || 0);
      };
      vA = parseId(a.id);
      vB = parseId(b.id);
    }
    return vA < vB ? -1 * estado.direcaoOrdenacao : vA > vB ? 1 * estado.direcaoOrdenacao : 0;
  });

  renderizarListaOS(filtrada);
}

// =========================================================================
// RENDERIZAÇÃO DOS CARDS (COM ESTADO DE CARREGAMENTO ISOLADO POR OS)
// =========================================================================
function renderizarListaOS(lista) {
  const container = document.getElementById('os-container');
  container.innerHTML = '';
  if (lista.length === 0) {
    container.innerHTML = `<div class="loading-state">Nenhuma solicitação encontrada.</div>`;
    return;
  }

  lista.forEach(os => {
    const pStr = String(os.prioridade || 'Média').toUpperCase();
    const isRed = pStr === 'ALTA' || pStr === 'URGENTE';
    const sStr = String(os.status || '').toUpperCase();
    let cor = 'var(--status-aberto)';
    const isConcluido = sStr.includes('CONCLUÍDO') || sStr.includes('CONCLUIDO');

    if (sStr.includes('ANDAMENTO')) cor = 'var(--status-andamento)';
    else if (sStr.includes('PEÇAS') || sStr.includes('PECAS') || sStr.includes('MATERIAL')) cor = 'var(--status-pecas)';
    else if (isConcluido) cor = 'var(--status-concluido)';

    const progReal = isConcluido ? 100 : Math.round(parseFloat(os.progresso) || 0);
    const dataAberturaBR = formatarDataBR(os.datasolicitacao);
    const dataPrevisaoBR = formatarDataBR(os.previsao) || 'Não informada';
    const dataConclusaoBR = formatarDataBR(os.dataconclusao);

    const card = document.createElement('div');
    card.className = 'os-card animate-hover';
    card.style.borderLeft = `5px solid ${cor}`;

    const carregandoStatus = isOsLoading(os.id, 'status');
    const isAguardando = sStr.includes('PEÇAS') || sStr.includes('PECAS') || sStr.includes('MATERIAL');

    const btnStatus = isAguardando
      ? `<button type="button" class="btn-texto-card animate-pop admin-only" ${carregandoStatus ? 'disabled' : ''} onclick="mudarStatusOS('${os.id}', 'Em Andamento')">
           ${carregandoStatus
             ? '<span class="material-symbols-outlined spinning-icon" style="font-size:16px;">sync</span> Atualizando...'
             : '<span class="material-symbols-outlined" style="font-size:16px; color:var(--status-concluido);">check_circle</span> Chegou Material'}
         </button>`
      : `<button type="button" class="btn-texto-card animate-pop admin-only" ${carregandoStatus ? 'disabled' : ''} onclick="mudarStatusOS('${os.id}', 'Aguardando Material')">
           ${carregandoStatus
             ? '<span class="material-symbols-outlined spinning-icon" style="font-size:16px;">sync</span> Atualizando...'
             : '<span class="material-symbols-outlined" style="font-size:16px; color:var(--status-pecas);">inventory_2</span> Aguard. Material'}
         </button>`;

    const rowConclusao = isConcluido
      ? `<div class="meta-row" style="width:100%; margin-top:2px;"><span class="meta-lbl">Concluído em:</span><span class="meta-val"><span class="material-symbols-outlined" style="color:var(--status-concluido); font-size:16px;">task_alt</span> ${dataConclusaoBR || 'N/D'}</span></div>`
      : '';

    card.innerHTML = `
      <div class="os-card-header">
        <span class="os-id"><span class="material-symbols-outlined" style="font-size:18px;">handyman</span> ${os.id}</span>
        ${os.prioridade && os.prioridade !== 'Padrão' ? `<span class="badge-prioridade" style="background:${isRed ? '#fecaca' : '#e2e8f0'}; color:${isRed ? '#b91c1c' : '#475569'};">${isRed ? '🚨 ' : ''}${os.prioridade}</span>` : ''}
      </div>
      <div style="font-size: 0.85rem; color: var(--text-muted); font-weight: 600; margin-bottom: 2px;">Local: ${os.setor}</div>
      <h3 class="os-titulo">${os.descricao}</h3>
      <div class="os-meta-grid">
        <div class="meta-row"><span class="meta-lbl">Abertura:</span><span class="meta-val"><span class="material-symbols-outlined" style="font-size:16px;">calendar_today</span> ${dataAberturaBR}</span></div>
        <div class="meta-row"><span class="meta-lbl">Previsão:</span><span class="meta-val"><span class="material-symbols-outlined" style="font-size:16px;">event_available</span> ${dataPrevisaoBR}</span></div>
        <div class="meta-row" style="width: 100%;"><span class="meta-lbl">Solicitante:</span><span class="meta-val"><span class="material-symbols-outlined" style="font-size:16px;">person</span> ${os.solicitante || ''} ${os.matricula ? `(Mat: ${os.matricula})` : ''}</span></div>
        ${rowConclusao}
      </div>
      <div class="os-footer" style="border-top:1px solid var(--border); padding-top:12px; margin-top:8px;">
        <div style="display:flex; align-items:center; gap:6px; font-size:0.85rem; font-weight:600; width:100%; margin-bottom:10px;">
          <span style="color:${cor}">${os.status}</span>
          <div class="mini-progress-bg" style="flex:1;"><div class="mini-progress-fill" style="width:${progReal}%; background:${cor}"></div></div>
          <span style="color:var(--text-muted); font-size:0.75rem;">${progReal}%</span>
        </div>
        <div class="os-card-actions-grid admin-only" style="grid-template-columns: 1fr 1fr;">
          ${btnStatus}
          <button type="button" class="btn-texto-card animate-pop" onclick="abrirModalEdicaoOS('${os.id}')"><span class="material-symbols-outlined" style="font-size:16px; color:var(--primary);">edit</span> Editar OS</button>
        </div>
        <div class="os-card-actions-grid" style="grid-template-columns: 1fr 1fr; margin-bottom:0;">
          <button type="button" class="btn-detalhes-full primary-style animate-pop" onclick="abrirDetalhesOS('${os.id}')">
            <span class="material-symbols-outlined" style="font-size:18px;">visibility</span> Visualizar Solicitação Completa
          </button>
          <button type="button" class="btn-detalhes-full animate-pop" onclick="abrirLinksDaOS('${os.id}')">
            <span class="material-symbols-outlined" style="font-size:18px;">folder_open</span> Visualizar Arquivos
          </button>
        </div>
      </div>
    `;
    container.appendChild(card);
  });
}

function formatarTextoComLinks(texto) {
  if (!texto) return "<i>Nenhuma informação adicional.</i>";
  const html = String(texto).replace(/https?:\/\/[^\s,]+/g, url =>
    `<a href="${url}" target="_blank" rel="noopener noreferrer" class="btn-outline" style="display:inline-flex; margin:4px 0; font-size:0.76rem; text-decoration:none;"><span class="material-symbols-outlined" style="font-size:15px; margin-right:4px;">open_in_new</span> Abrir Anexo no Drive</a>`
  );
  return html.replace(/\n/g, '<br>');
}

// =========================================================================
// VISUALIZAR ARQUIVOS DIRETAMENTE PELO CARD
// =========================================================================
function abrirLinksDaOS(idOS) {
  const os = todasOS.find(o => o.id === idOS);
  const texto = os ? String(os.observacoes || '') : '';
  const regex = /https?:\/\/[^\s,]+/g;
  const links = texto.match(regex);
  const painel = document.getElementById('lista-links-arquivos');
  painel.innerHTML = '';

  if (!links || links.length === 0) {
    painel.innerHTML = '<p style="text-align:center; color:var(--text-muted); font-size:0.9rem; padding:15px 0;">Esta solicitação não possui arquivos ou fotos anexados.</p>';
  } else {
    links.forEach((link, idx) => {
      painel.innerHTML += `
        <a href="${link}" target="_blank" rel="noopener noreferrer" class="btn-outline animate-pop" style="justify-content:flex-start; padding:12px;">
          <span class="material-symbols-outlined">open_in_new</span> Abrir Arquivo / Foto ${idx + 1}
        </a>`;
    });
  }
  document.getElementById('modal-visualizar-arquivos').classList.add('active');
  atualizarScrollBody();
}

// =========================================================================
// ESCOLHA ENTRE CÂMERA E GALERIA (CRIAÇÃO E DETALHES DA OS)
// =========================================================================
function abrirEscolhaFoto(contexto) {
  contextoEscolhaFoto = contexto;
  document.getElementById('modal-escolha-foto').classList.add('active');
  atualizarScrollBody();
}

function selecionarOrigemFoto(origem) {
  origemFotoUploadAtual = origem;
  fecharModal('modal-escolha-foto');

  if (contextoEscolhaFoto === 'CRIACAO') {
    const inputId = origem === 'CAMERA' ? 'input-foto-criacao-camera' : 'input-foto-criacao-galeria';
    const input = document.getElementById(inputId);
    if (input) {
      input.value = '';
      input.click();
    }
  } else {
    const inputId = origem === 'CAMERA' ? 'input-foto-detalhes-camera' : 'input-foto-detalhes-galeria';
    const input = document.getElementById(inputId);
    if (input) {
      input.value = '';
      input.click();
    }
  }
}

// =========================================================================
// LEITURA E OTIMIZAÇÃO DE FOTOS/ARQUIVOS (DESKTOP E MOBILE)
// =========================================================================
function inferirMimeType(file) {
  if (file.type && file.type.trim() !== '') return file.type;
  const nome = String(file.name || '').toLowerCase();
  if (nome.endsWith('.jpg') || nome.endsWith('.jpeg')) return 'image/jpeg';
  if (nome.endsWith('.png')) return 'image/png';
  if (nome.endsWith('.webp')) return 'image/webp';
  if (nome.endsWith('.heic')) return 'image/heic';
  if (nome.endsWith('.heif')) return 'image/heif';
  if (nome.endsWith('.pdf')) return 'application/pdf';
  if (nome.endsWith('.doc')) return 'application/msword';
  if (nome.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (nome.endsWith('.xls')) return 'application/vnd.ms-excel';
  if (nome.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  return 'application/octet-stream';
}

function lerFileReaderDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (!reader.result || String(reader.result).indexOf(',') === -1) {
        reject(new Error('Não foi possível ler o arquivo: ' + file.name));
        return;
      }
      resolve(reader.result);
    };
    reader.onerror = () => reject(new Error('Erro de leitura no arquivo: ' + file.name));
    reader.readAsDataURL(file);
  });
}

function comprimirImagemSeNecessario(dataUrl, file, mimeType) {
  return new Promise((resolve, reject) => {
    const isImagem = mimeType.startsWith('image/');
    if (!isImagem) {
      resolve({ base64: dataUrl, mimeType: mimeType, nome: file.name, isImagem: false });
      return;
    }

    // Imagens pequenas (< 850 KB) não precisam de recompressão
    if (file.size <= 850 * 1024 && !mimeType.includes('heic') && !mimeType.includes('heif')) {
      resolve({ base64: dataUrl, mimeType: mimeType, nome: file.name, isImagem: true });
      return;
    }

    const img = new Image();
    img.onload = () => {
      try {
        const MAX_DIM = 1600;
        let width = img.naturalWidth || img.width;
        let height = img.naturalHeight || img.height;

        if (width > MAX_DIM || height > MAX_DIM) {
          if (width >= height) {
            height = Math.round((height * MAX_DIM) / width);
            width = MAX_DIM;
          } else {
            width = Math.round((width * MAX_DIM) / height);
            height = MAX_DIM;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.80);
        const nomeBase = (file.name || 'foto_mobile').replace(/\.[^/.]+$/, '');
        resolve({
          base64: compressedDataUrl,
          mimeType: 'image/jpeg',
          nome: nomeBase + '.jpg',
          isImagem: true
        });
      } catch (e) {
        if (file.size > 4.5 * 1024 * 1024) {
          reject(new Error('A foto selecionada é muito grande para envio mobile. Reduza a resolução ou escolha outra imagem.'));
        } else {
          resolve({ base64: dataUrl, mimeType: mimeType, nome: file.name, isImagem: true });
        }
      }
    };

    img.onerror = () => {
      // Caso o navegador não decodifique HEIC nativamente no Canvas
      if (file.size > 4.5 * 1024 * 1024) {
        reject(new Error('Formato de imagem não suportado em alta resolução (' + file.name + '). Configure a câmera para JPG/Compatível ou selecione uma imagem menor.'));
      } else {
        resolve({ base64: dataUrl, mimeType: mimeType, nome: file.name, isImagem: true });
      }
    };

    img.src = dataUrl;
  });
}

async function prepararArquivoParaEnvio(file) {
  const mimeType = inferirMimeType(file);
  const dataUrl = await lerFileReaderDataURL(file);
  const processado = await comprimirImagemSeNecessario(dataUrl, file, mimeType);
  return {
    idLocal: 'ANX_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
    nome: processado.nome,
    mimeType: processado.mimeType,
    base64: processado.base64,
    isImagem: processado.isImagem
  };
}

function atualizarStatusProcessamentoCriacao() {
  const box = document.getElementById('status-processamento-criacao');
  const btn = document.getElementById('btn-salvar-os');
  if (!box || !btn) return;

  if (processandoArquivosCount > 0) {
    box.style.display = 'flex';
    btn.disabled = true;
  } else {
    box.style.display = 'none';
    if (!salvandoOS) btn.disabled = false;
  }
}

async function adicionarArquivosCriacao(event) {
  const files = Array.from(event.target.files || []);
  if (files.length === 0) return;

  processandoArquivosCount++;
  atualizarStatusProcessamentoCriacao();

  try {
    for (const file of files) {
      const item = await prepararArquivoParaEnvio(file);
      arquivosNovaOS.push(item);
      renderizarPreviewArquivosCriacao();
    }
  } catch (err) {
    alert(err.message || 'Não foi possível processar o arquivo selecionado.');
  } finally {
    processandoArquivosCount = Math.max(0, processandoArquivosCount - 1);
    atualizarStatusProcessamentoCriacao();
    event.target.value = '';
  }
}

function removerArquivoCriacao(idLocal) {
  arquivosNovaOS = arquivosNovaOS.filter(a => a.idLocal !== idLocal);
  renderizarPreviewArquivosCriacao();
}

function renderizarPreviewArquivosCriacao() {
  const painel = document.getElementById('preview-arquivos-criacao');
  painel.innerHTML = '';

  arquivosNovaOS.forEach(anexo => {
    const miniatura = anexo.isImagem
      ? `<img src="${anexo.base64}" alt="${anexo.nome}" class="anexo-thumb">`
      : `<div class="anexo-doc-icon"><span class="material-symbols-outlined">description</span></div>`;

    painel.innerHTML += `
      <div class="anexo-item-card">
        <div class="anexo-item-info">
          ${miniatura}
          <span class="anexo-nome" title="${anexo.nome}">${anexo.nome}</span>
        </div>
        <button type="button" class="btn-remover-anexo" onclick="removerArquivoCriacao('${anexo.idLocal}')" title="Remover anexo">
          <span class="material-symbols-outlined" style="font-size:16px;">close</span>
        </button>
      </div>
    `;
  });
}

// =========================================================================
// CRIAÇÃO E EDIÇÃO DE ORDEM DE SERVIÇO
// =========================================================================
function abrirModalNovaOS() {
  limparEstadoNovaOS();
  document.getElementById('form-nova-os').reset();
  document.getElementById('edit-os-id').value = '';
  document.getElementById('titulo-modal-os').textContent = 'Criar Nova Solicitação';
  document.getElementById('msg-aviso-publico').style.display = 'block';
  document.getElementById('area-upload-criacao').style.display = 'flex';
  document.getElementById('admin-fields-os').style.display = 'none';

  if (usuarioAdmin) {
    document.getElementById('nova-os-solicitante').value = usuarioAdmin.nome;
  }

  const btn = document.getElementById('btn-salvar-os');
  btn.innerHTML = 'Salvar O.S.';
  btn.disabled = false;

  document.getElementById('modal-nova-os').classList.add('active');
  atualizarScrollBody();
}

function abrirModalEdicaoOS(idOS) {
  const os = todasOS.find(o => o.id === idOS);
  if (!os) return;

  limparEstadoNovaOS();
  document.getElementById('titulo-modal-os').textContent = `Editar OS: ${idOS}`;
  document.getElementById('edit-os-id').value = idOS;
  document.getElementById('msg-aviso-publico').style.display = 'none';
  document.getElementById('area-upload-criacao').style.display = 'none';
  document.getElementById('admin-fields-os').style.display = 'flex';

  document.getElementById('nova-os-matricula').value = os.matricula || '';
  document.getElementById('nova-os-solicitante').value = os.solicitante || '';
  document.getElementById('nova-os-local').value = os.setor || '';
  document.getElementById('nova-os-desc').value = os.descricao || '';
  document.getElementById('nova-os-prio').value = (os.prioridade && os.prioridade !== 'Padrão') ? os.prioridade : 'Média';
  document.getElementById('nova-os-prev').value = converterBRParaInputDate(os.previsao);

  const btn = document.getElementById('btn-salvar-os');
  btn.innerHTML = 'Salvar Alterações';
  btn.disabled = false;

  document.getElementById('modal-nova-os').classList.add('active');
  atualizarScrollBody();
}

document.getElementById('form-nova-os').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (salvandoOS || processandoArquivosCount > 0) return;

  const btn = document.getElementById('btn-salvar-os');
  const idEdicao = document.getElementById('edit-os-id').value.trim();
  const acaoCall = idEdicao ? 'editarOS' : 'novaOS';

  let prevInput = document.getElementById('nova-os-prev').value;
  let prevFormatada = 'Não informada';
  if (prevInput && prevInput.includes('-')) {
    const [a, m, d] = prevInput.split('-');
    prevFormatada = `${d}/${m}/${a}`;
  }

  const anexosEnvio = idEdicao ? [] : arquivosNovaOS.map(a => ({
    nome: a.nome,
    mimeType: a.mimeType,
    base64: a.base64
  }));

  // Valida tamanho total do pacote antes do envio para evitar falha silenciosa no celular
  const tamanhoTotalBytes = anexosEnvio.reduce((acc, item) => acc + (item.base64 ? item.base64.length : 0), 0);
  if (tamanhoTotalBytes > 6.5 * 1024 * 1024) {
    alert('O tamanho total dos anexos excede o limite de envio (aprox. 5 MB). Remova algum arquivo ou envie em partes.');
    return;
  }

  const payload = {
    idOS: idEdicao,
    matricula: document.getElementById('nova-os-matricula').value.trim(),
    solicitante: document.getElementById('nova-os-solicitante').value.trim(),
    setor: document.getElementById('nova-os-local').value.trim(),
    descricao: document.getElementById('nova-os-desc').value.trim(),
    prioridade: idEdicao ? document.getElementById('nova-os-prio').value : 'Média',
    previsao: idEdicao ? prevFormatada : 'Não informada',
    anexos: anexosEnvio
  };

  salvandoOS = true;
  btn.innerHTML = '<span class="material-symbols-outlined spinning-icon">sync</span> Enviando...';
  btn.disabled = true;

  try {
    const res = await apiCall(acaoCall, payload);
    salvandoOS = false;
    if (res.status === 'sucesso') {
      fecharModal('modal-nova-os');
      await carregarDadosAPI();
      if (!idEdicao) alert(res.mensagem || 'Ordem de Serviço criada com sucesso!');
    } else {
      alert('Falha: ' + (res.mensagem || 'Erro desconhecido.'));
      if (res.mensagem && res.mensagem.includes('Acesso negado')) fazerLogout(false);
    }
  } catch (err) {
    salvandoOS = false;
    alert('Erro de comunicação com o servidor ao salvar OS. Verifique sua conexão e tente novamente.');
  } finally {
    salvandoOS = false;
    btn.innerHTML = idEdicao ? 'Salvar Alterações' : 'Salvar O.S.';
    btn.disabled = false;
  }
});

// =========================================================================
// UPLOAD DE FOTO / ARQUIVO DENTRO DOS DETALHES DA OS
// =========================================================================
async function receberFotoDetalhes(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  abrirModalUploadAnexo('FOTO');
  const prev = document.getElementById('preview-anexo-unico');
  prev.innerHTML = '<span class="material-symbols-outlined spinning-icon" style="font-size:16px;">sync</span> Processando foto...';

  try {
    arquivoUnicoParaUpload = await prepararArquivoParaEnvio(file);
    prev.innerHTML = `<img src="${arquivoUnicoParaUpload.base64}" style="max-height:95px; border-radius:8px; margin-bottom:4px; border:1px solid var(--border);"><br>${arquivoUnicoParaUpload.nome}`;
  } catch (err) {
    arquivoUnicoParaUpload = null;
    prev.textContent = '';
    alert(err.message || 'Erro ao ler a foto.');
  } finally {
    event.target.value = '';
  }
}

function abrirModalUploadAnexo(tipo) {
  tipoUploadAnexoAtual = tipo;
  limparEstadoUploadAnexo();

  const isFoto = tipo === 'FOTO';
  document.getElementById('upload-anexo-titulo').textContent = isFoto ? 'Anexar Foto à O.S.' : 'Anexar Documento à O.S.';
  document.getElementById('texto-btn-escolher-anexo').textContent = isFoto ? 'Escolher Outra Foto' : 'Selecionar Documento (PDF, DOC, XLS...)';
  document.getElementById('icone-upload-anexo').textContent = isFoto ? 'add_a_photo' : 'upload_file';
  document.getElementById('input-anexo-os').accept = isFoto ? 'image/jpeg,image/jpg,image/png,image/webp,image/*' : '.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,application/pdf';
  document.getElementById('input-autor-anexo').value = usuarioAdmin ? usuarioAdmin.nome : '';

  const btn = document.getElementById('btn-confirmar-upload-anexo');
  btn.innerHTML = 'Enviar Anexo';
  btn.disabled = false;

  document.getElementById('modal-upload-anexo').classList.add('active');
  atualizarScrollBody();
}

function acionarSeletorModalUpload() {
  if (tipoUploadAnexoAtual === 'FOTO') {
    abrirEscolhaFoto('DETALHES');
  } else {
    const input = document.getElementById('input-anexo-os');
    input.value = '';
    input.click();
  }
}

async function lerArquivoParaUpload(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  const prev = document.getElementById('preview-anexo-unico');
  prev.innerHTML = '<span class="material-symbols-outlined spinning-icon" style="font-size:16px;">sync</span> Processando arquivo...';

  try {
    arquivoUnicoParaUpload = await prepararArquivoParaEnvio(file);
    if (arquivoUnicoParaUpload.isImagem) {
      prev.innerHTML = `<img src="${arquivoUnicoParaUpload.base64}" style="max-height:90px; border-radius:8px; margin-bottom:4px; border:1px solid var(--border);"><br>${arquivoUnicoParaUpload.nome}`;
    } else {
      prev.textContent = `Arquivo selecionado: ${arquivoUnicoParaUpload.nome}`;
    }
  } catch (err) {
    arquivoUnicoParaUpload = null;
    prev.textContent = '';
    alert(err.message);
  }
}

async function enviarAnexoParaOS() {
  if (enviandoAnexo) return;

  const autor = document.getElementById('input-autor-anexo').value.trim();
  if (!arquivoUnicoParaUpload || !arquivoUnicoParaUpload.base64) {
    alert('Selecione uma foto ou documento antes de clicar em Enviar Anexo.');
    return;
  }
  if (!autor) {
    alert('Por favor, informe seu nome para identificação do envio.');
    return;
  }

  const btn = document.getElementById('btn-confirmar-upload-anexo');
  enviandoAnexo = true;
  btn.innerHTML = '<span class="material-symbols-outlined spinning-icon">sync</span> Enviando ao Drive...';
  btn.disabled = true;

  try {
    const res = await apiCall('addAnexoOS', {
      alvoID: osAbertaNoModal,
      autor: autor,
      anexos: [{
        nome: arquivoUnicoParaUpload.nome,
        mimeType: arquivoUnicoParaUpload.mimeType,
        base64: arquivoUnicoParaUpload.base64
      }]
    });

    enviandoAnexo = false;
    if (res.status === 'sucesso') {
      fecharModal('modal-upload-anexo');
      await carregarDadosAPI();
      const osAtualizada = todasOS.find(o => o.id === osAbertaNoModal);
      if (osAtualizada) {
        document.getElementById('modal-desc').innerHTML = formatarTextoComLinks(osAtualizada.observacoes);
      }
      alert(res.mensagem || 'Anexo enviado com sucesso!');
    } else {
      alert('Erro ao enviar anexo: ' + (res.mensagem || 'Falha desconhecida.'));
    }
  } catch (err) {
    enviandoAnexo = false;
    alert('Erro de comunicação durante o envio do arquivo.');
  } finally {
    enviandoAnexo = false;
    btn.innerHTML = 'Enviar Anexo';
    btn.disabled = false;
  }
}

// =========================================================================
// DETALHES COMPLETOS DA OS, NOVO FLUXO DE PROGRESSO E ESTADOS ISOLADOS
// =========================================================================
function atualizarBotaoStatusProgressoModal(os) {
  const btn = document.getElementById('btn-status-progresso-os');
  if (!btn || !os) return;

  const sStr = String(os.status || '').toUpperCase();
  const isConcluido = sStr.includes('CONCLUÍDO') || sStr.includes('CONCLUIDO');
  const prog = Math.round(parseFloat(os.progresso) || 0);
  const carregando = isOsLoading(os.id, 'progresso');

  if (isConcluido) {
    btn.style.display = 'none';
    btn.disabled = false;
    return;
  }

  btn.style.display = 'inline-flex';
  btn.disabled = carregando;

  const isEmAberto = (sStr.includes('ABERTO') || sStr.includes('NÃO INICIADO')) && prog === 0;
  if (isEmAberto) {
    btn.classList.remove('modo-alterar');
    btn.innerHTML = carregando
      ? '<span class="material-symbols-outlined spinning-icon" style="font-size:15px;">sync</span> Iniciando...'
      : '<span class="material-symbols-outlined" style="font-size:15px;">play_arrow</span> OS EM ANDAMENTO';
  } else {
    btn.classList.add('modo-alterar');
    btn.innerHTML = carregando
      ? '<span class="material-symbols-outlined spinning-icon" style="font-size:15px;">sync</span> Salvando...'
      : `<span class="material-symbols-outlined" style="font-size:15px;">tune</span> ALTERAR PROGRESSO (${prog}%)`;
  }
}

function abrirDetalhesOS(idOS) {
  const os = todasOS.find(o => o.id === idOS);
  if (!os) return;

  osAbertaNoModal = os.id;
  const sStr = String(os.status || '').toUpperCase();
  const isConcluido = sStr.includes('CONCLUÍDO') || sStr.includes('CONCLUIDO');
  let cor = 'var(--status-aberto)';
  if (sStr.includes('ANDAMENTO')) cor = 'var(--status-andamento)';
  else if (sStr.includes('PEÇAS') || sStr.includes('PECAS') || sStr.includes('MATERIAL')) cor = 'var(--status-pecas)';
  else if (isConcluido) cor = 'var(--status-concluido)';

  const progressoReal = isConcluido ? 100 : Math.round(parseFloat(os.progresso) || 0);

  document.getElementById('modal-id').textContent = os.id;
  document.getElementById('modal-status').textContent = os.status;
  document.getElementById('modal-status').style.color = cor;

  const isRed = String(os.prioridade || '').toUpperCase() === 'ALTA' || String(os.prioridade || '').toUpperCase() === 'URGENTE';
  document.getElementById('modal-prioridade').innerHTML = (os.prioridade && os.prioridade !== 'Padrão')
    ? `<span class="badge-prioridade" style="background:${isRed ? '#fecaca' : '#e2e8f0'}; color:${isRed ? '#b91c1c' : '#475569'};">${isRed ? '🚨 ' : ''}${os.prioridade}</span>`
    : '';
  document.getElementById('modal-titulo').textContent = `${os.setor} - ${os.descricao}`;

  // Atualiza botão dinâmico OS EM ANDAMENTO / ALTERAR PROGRESSO
  atualizarBotaoStatusProgressoModal(os);

  const dataAberturaBR = formatarDataBR(os.datasolicitacao);
  const dataPrevisaoBR = formatarDataBR(os.previsao) || 'Não informada';
  const dataConclusaoBR = formatarDataBR(os.dataconclusao);

  let gridDatas = `
    <strong>Matrícula:</strong> ${os.matricula || 'Não informada'}<br>
    <strong>Solicitante:</strong> ${os.solicitante || 'N/D'}<br>
    <strong>Setor / Local:</strong> ${os.setor || 'N/D'}<br>
    <strong>Abertura:</strong> ${dataAberturaBR}<br>
    <strong>Previsão de Conclusão:</strong> ${dataPrevisaoBR}
  `;
  if (isConcluido) {
    gridDatas += `<br><strong style="color:var(--status-concluido);">Concluído em:</strong> <span style="color:var(--status-concluido); font-weight:bold;">${dataConclusaoBR || 'N/D'}</span>`;
  }
  document.getElementById('grid-datas-modal').innerHTML = gridDatas;

  document.getElementById('modal-progresso-txt').textContent = `${progressoReal}%`;
  document.getElementById('modal-progresso-bar').style.width = `${progressoReal}%`;
  document.getElementById('modal-progresso-bar').style.backgroundColor = cor;

  // Restaura explicitamente o estado dos botões administrativos do modal conforme o ID da OS atual
  const btnExcluir = document.getElementById('btn-excluir-os-modal');
  const carregandoExcluir = isOsLoading(os.id, 'excluir');
  btnExcluir.disabled = carregandoExcluir;
  btnExcluir.innerHTML = carregandoExcluir
    ? '<span class="material-symbols-outlined spinning-icon" style="font-size:18px;">sync</span> Excluindo...'
    : '<span class="material-symbols-outlined" style="font-size:18px;">delete</span> Excluir O.S';

  const btnConcluir = document.getElementById('btn-concluir-os-direto');
  const carregandoConcluir = isOsLoading(os.id, 'concluir');
  btnConcluir.disabled = carregandoConcluir;
  btnConcluir.innerHTML = carregandoConcluir
    ? '<span class="material-symbols-outlined spinning-icon" style="font-size:18px;">sync</span> Concluindo...'
    : '<span class="material-symbols-outlined" style="font-size:18px;">done_all</span> Concluir O.S. Imediatamente (100%)';

  const btnReverter = document.getElementById('btn-reverter-os');
  const carregandoReabrir = isOsLoading(os.id, 'reabrir');
  btnReverter.disabled = carregandoReabrir;
  btnReverter.innerHTML = carregandoReabrir
    ? '<span class="material-symbols-outlined spinning-icon" style="font-size:18px;">sync</span> Reabrindo...'
    : '<span class="material-symbols-outlined" style="font-size:18px;">undo</span> Reabrir O.S. (Voltar para Em Andamento)';

  if (isConcluido) {
    btnConcluir.style.display = 'none';
    btnReverter.style.display = 'flex';
  } else {
    btnConcluir.style.display = 'flex';
    btnReverter.style.display = 'none';
  }

  document.getElementById('modal-desc').innerHTML = formatarTextoComLinks(os.observacoes);
  document.getElementById('modal-detalhes').classList.add('active');
  atualizarScrollBody();
  carregarSubTarefasDaOS(os.id);
}

// Ação do botão superior direito: "OS EM ANDAMENTO" (0% -> 1%) ou "ALTERAR PROGRESSO" (1%..100%)
async function acaoBotaoStatusProgresso() {
  const os = todasOS.find(o => o.id === osAbertaNoModal);
  if (!os || isOsLoading(os.id, 'progresso')) return;

  const sStr = String(os.status || '').toUpperCase();
  const progAtual = Math.round(parseFloat(os.progresso) || 0);
  const isEmAberto = (sStr.includes('ABERTO') || sStr.includes('NÃO INICIADO')) && progAtual === 0;

  if (isEmAberto) {
    const idTarget = os.id;
    setOsLoading(idTarget, 'progresso', true);
    atualizarBotaoStatusProgressoModal(os);

    try {
      const res = await apiCall('atualizarProgressoOS', {
        idOS: idTarget,
        novoProgresso: 1,
        novoStatus: 'Em Andamento'
      });
      setOsLoading(idTarget, 'progresso', false);

      if (res.status === 'sucesso') {
        await carregarDadosAPI();
        if (osAbertaNoModal === idTarget && document.getElementById('modal-detalhes').classList.contains('active')) {
          abrirDetalhesOS(idTarget);
        }
      } else {
        alert(res.mensagem || 'Não foi possível iniciar a O.S.');
        if (osAbertaNoModal === idTarget) abrirDetalhesOS(idTarget);
      }
    } catch (e) {
      setOsLoading(idTarget, 'progresso', false);
      alert('Erro de comunicação ao iniciar a O.S.');
      if (osAbertaNoModal === idTarget) abrirDetalhesOS(idTarget);
    }
  } else {
    abrirModalProgressoOS(os);
  }
}

function abrirModalProgressoOS(os) {
  const progInicial = Math.min(100, Math.max(1, Math.round(parseFloat(os.progresso) || 1)));
  const slider = document.getElementById('slider-progresso-os');
  slider.value = progInicial;
  atualizarPreviewSliderProgresso(progInicial);

  const btnConfirmar = document.getElementById('btn-confirmar-progresso-os');
  btnConfirmar.disabled = false;
  btnConfirmar.innerHTML = 'Confirmar Progresso';

  document.getElementById('modal-progresso-os').classList.add('active');
  atualizarScrollBody();
}

function definirValorSliderProgresso(valor) {
  const slider = document.getElementById('slider-progresso-os');
  slider.value = valor;
  atualizarPreviewSliderProgresso(valor);
}

function atualizarPreviewSliderProgresso(valor) {
  const num = parseInt(valor, 10) || 1;
  const display = document.getElementById('valor-progresso-slider');
  const aviso = document.getElementById('aviso-conclusao-slider');

  display.textContent = num + '%';
  if (num === 100) {
    display.style.color = 'var(--status-concluido)';
    aviso.textContent = 'Ao confirmar 100%, a O.S. será marcada automaticamente como Concluída.';
    aviso.style.color = 'var(--status-concluido)';
  } else {
    display.style.color = 'var(--primary)';
    aviso.textContent = 'Status: Em Andamento (' + num + '%)';
    aviso.style.color = 'var(--text-muted)';
  }
}

async function salvarProgressoManualOS() {
  const idTarget = osAbertaNoModal;
  if (!idTarget || isOsLoading(idTarget, 'progresso')) return;

  const valor = Math.min(100, Math.max(1, parseInt(document.getElementById('slider-progresso-os').value, 10) || 1));
  const isConcluindo = valor === 100;
  const novoStatus = isConcluindo ? 'Concluído' : 'Em Andamento';
  const hojeBR = new Date().toLocaleDateString('pt-BR');

  const btn = document.getElementById('btn-confirmar-progresso-os');
  setOsLoading(idTarget, 'progresso', true);
  btn.innerHTML = '<span class="material-symbols-outlined spinning-icon">sync</span> Salvando...';
  btn.disabled = true;

  try {
    const payload = {
      idOS: idTarget,
      novoProgresso: valor,
      novoStatus: novoStatus
    };
    if (isConcluindo) payload.dataConclusao = hojeBR;

    const res = await apiCall('atualizarProgressoOS', payload);
    setOsLoading(idTarget, 'progresso', false);

    if (res.status === 'sucesso') {
      fecharModal('modal-progresso-os');
      await carregarDadosAPI();
      if (osAbertaNoModal === idTarget && document.getElementById('modal-detalhes').classList.contains('active')) {
        abrirDetalhesOS(idTarget);
      }
    } else {
      alert(res.mensagem || 'Erro ao atualizar progresso.');
    }
  } catch (e) {
    setOsLoading(idTarget, 'progresso', false);
    alert('Erro de comunicação ao salvar progresso.');
  } finally {
    setOsLoading(idTarget, 'progresso', false);
    btn.innerHTML = 'Confirmar Progresso';
    btn.disabled = false;
  }
}

async function mudarStatusOS(idOS, novoStatus) {
  if (isOsLoading(idOS, 'status')) return;
  setOsLoading(idOS, 'status', true);
  aplicarFiltrosEOrdenacao();

  try {
    const res = await apiCall('mudarStatusDireto', { idOS: idOS, novoStatus: novoStatus });
    setOsLoading(idOS, 'status', false);
    if (res.status === 'sucesso') {
      await carregarDadosAPI();
    } else {
      alert('Erro: ' + (res.mensagem || 'Falha ao alterar status.'));
      aplicarFiltrosEOrdenacao();
    }
  } catch (e) {
    setOsLoading(idOS, 'status', false);
    alert('Erro de comunicação ao alterar status.');
    aplicarFiltrosEOrdenacao();
  }
}

async function deletarOS() {
  const idTarget = osAbertaNoModal;
  if (!idTarget || isOsLoading(idTarget, 'excluir')) return;
  if (!confirm('Deseja EXCLUIR permanentemente esta O.S?')) return;

  const btn = document.getElementById('btn-excluir-os-modal');
  setOsLoading(idTarget, 'excluir', true);
  btn.innerHTML = '<span class="material-symbols-outlined spinning-icon" style="font-size:18px;">sync</span> Excluindo...';
  btn.disabled = true;

  try {
    const res = await apiCall('excluirOS', { idOS: idTarget });
    limparEstadosDaOS(idTarget);

    if (res.status === 'sucesso') {
      osAbertaNoModal = null;
      fecharModal('modal-detalhes');
      await carregarDadosAPI();
    } else {
      alert(res.mensagem || 'Erro ao excluir O.S.');
      if (osAbertaNoModal === idTarget) abrirDetalhesOS(idTarget);
    }
  } catch (e) {
    limparEstadosDaOS(idTarget);
    alert('Erro de comunicação ao excluir O.S.');
    if (osAbertaNoModal === idTarget) abrirDetalhesOS(idTarget);
  } finally {
    btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:18px;">delete</span> Excluir O.S';
    btn.disabled = false;
  }
}

function editarObservacaoOS() {
  const os = todasOS.find(o => o.id === osAbertaNoModal);
  if (!os) return;
  const txt = prompt('Edite as Orientações / Informações da OS:', os.observacoes || '');
  if (txt === null) return;
  const btn = document.getElementById('btn-edit-obs-os');
  if (btn) {
    btn.innerHTML = '<span class="material-symbols-outlined spinning-icon" style="font-size:16px;">sync</span>';
    btn.disabled = true;
  }
  apiCall('editarObservacaoOS', { idOS: osAbertaNoModal, observacao: txt })
    .then(res => {
      if (res.status === 'sucesso') {
        os.observacoes = txt;
        document.getElementById('modal-desc').innerHTML = formatarTextoComLinks(txt);
      }
    })
    .finally(() => {
      if (btn) {
        btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:16px;">edit</span>';
        btn.disabled = false;
      }
    });
}

async function concluirOSDireto() {
  const idTarget = osAbertaNoModal;
  if (!idTarget || isOsLoading(idTarget, 'concluir')) return;
  if (!confirm('Concluir esta O.S. integralmente (100%)?')) return;

  const btn = document.getElementById('btn-concluir-os-direto');
  setOsLoading(idTarget, 'concluir', true);
  btn.innerHTML = '<span class="material-symbols-outlined spinning-icon" style="font-size:18px;">sync</span> Concluindo...';
  btn.disabled = true;

  try {
    const hojeBR = new Date().toLocaleDateString('pt-BR');
    const res = await apiCall('atualizarProgressoOS', {
      idOS: idTarget,
      novoProgresso: 100,
      novoStatus: 'Concluído',
      dataConclusao: hojeBR
    });
    setOsLoading(idTarget, 'concluir', false);

    if (res.status === 'sucesso') {
      await carregarDadosAPI();
      if (osAbertaNoModal === idTarget && document.getElementById('modal-detalhes').classList.contains('active')) {
        abrirDetalhesOS(idTarget);
      }
    } else {
      alert(res.mensagem || 'Erro ao concluir O.S.');
      if (osAbertaNoModal === idTarget) abrirDetalhesOS(idTarget);
    }
  } catch (e) {
    setOsLoading(idTarget, 'concluir', false);
    alert('Erro de comunicação ao concluir O.S.');
    if (osAbertaNoModal === idTarget) abrirDetalhesOS(idTarget);
  } finally {
    setOsLoading(idTarget, 'concluir', false);
    btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:18px;">done_all</span> Concluir O.S. Imediatamente (100%)';
    btn.disabled = false;
  }
}

async function reverterOSParaAndamento() {
  const idTarget = osAbertaNoModal;
  if (!idTarget || isOsLoading(idTarget, 'reabrir')) return;
  if (!confirm('Reabrir esta O.S. para "Em Andamento"?')) return;

  const btn = document.getElementById('btn-reverter-os');
  setOsLoading(idTarget, 'reabrir', true);
  btn.innerHTML = '<span class="material-symbols-outlined spinning-icon" style="font-size:18px;">sync</span> Reabrindo...';
  btn.disabled = true;

  try {
    const res = await apiCall('atualizarProgressoOS', {
      idOS: idTarget,
      novoProgresso: 50,
      novoStatus: 'Em Andamento',
      dataConclusao: ''
    });
    setOsLoading(idTarget, 'reabrir', false);

    if (res.status === 'sucesso') {
      await carregarDadosAPI();
      if (osAbertaNoModal === idTarget && document.getElementById('modal-detalhes').classList.contains('active')) {
        abrirDetalhesOS(idTarget);
      }
    } else {
      alert(res.mensagem || 'Erro ao reabrir O.S.');
      if (osAbertaNoModal === idTarget) abrirDetalhesOS(idTarget);
    }
  } catch (e) {
    setOsLoading(idTarget, 'reabrir', false);
    alert('Erro de comunicação ao reabrir O.S.');
    if (osAbertaNoModal === idTarget) abrirDetalhesOS(idTarget);
  } finally {
    setOsLoading(idTarget, 'reabrir', false);
    btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:18px;">undo</span> Reabrir O.S. (Voltar para Em Andamento)';
    btn.disabled = false;
  }
}

// =========================================================================
// SUBTAREFAS (INDEPENDENTES DO PROGRESSO DA OS E COM ANTI-DUPLICIDADE)
// =========================================================================
function abrirNovaSubTarefa() {
  const form = document.getElementById('form-sub-tarefa');
  form.style.display = 'flex';
  const btn = document.getElementById('btn-salvar-subtarefa');
  if (btn) {
    btn.disabled = false;
    btn.innerHTML = 'Salvar Pendência';
  }
}

async function salvarSubTarefa() {
  if (salvandoSubtarefa) return;

  const descInput = document.getElementById('sub-desc');
  const respInput = document.getElementById('sub-resp');
  const desc = descInput.value.trim();
  const resp = respInput.value.trim();

  if (!desc) {
    alert('Informe a descrição da pendência.');
    return;
  }

  const btn = document.getElementById('btn-salvar-subtarefa');
  salvandoSubtarefa = true;
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="material-symbols-outlined spinning-icon" style="font-size:15px;">sync</span> Salvando...';
  }

  try {
    const res = await apiCall('novaSubTarefa', {
      idOS: osAbertaNoModal,
      descricao: desc,
      responsavel: resp || 'Equipe Predial'
    });

    if (res.status === 'sucesso') {
      document.getElementById('form-sub-tarefa').style.display = 'none';
      descInput.value = '';
      respInput.value = '';
      await carregarSubTarefasDaOS(osAbertaNoModal);
    } else {
      alert(res.mensagem || 'Erro ao salvar pendência. Tente novamente.');
    }
  } catch (e) {
    alert('Erro de comunicação ao salvar pendência. Tente novamente.');
  } finally {
    salvandoSubtarefa = false;
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = 'Salvar Pendência';
    }
  }
}

function abrirModalEditarSubTarefa(idSub) {
  const sub = subTarefasAtuais.find(s => s.idSub === idSub);
  if (!sub) return;

  document.getElementById('edit-sub-id').value = sub.idSub;
  document.getElementById('edit-sub-desc').value = sub.descricao || '';
  document.getElementById('edit-sub-resp').value = sub.responsavel || '';

  const btn = document.getElementById('btn-salvar-edicao-sub');
  btn.innerHTML = 'Salvar Alterações';
  btn.disabled = false;

  document.getElementById('modal-editar-subtarefa').classList.add('active');
  atualizarScrollBody();
}

async function salvarEdicaoSubTarefa() {
  if (salvandoEdicaoSub) return;

  const idSub = document.getElementById('edit-sub-id').value.trim();
  const descricao = document.getElementById('edit-sub-desc').value.trim();
  const responsavel = document.getElementById('edit-sub-resp').value.trim();

  if (!descricao) {
    alert('A descrição da sub-tarefa não pode ficar vazia.');
    return;
  }

  const btn = document.getElementById('btn-salvar-edicao-sub');
  salvandoEdicaoSub = true;
  btn.innerHTML = '<span class="material-symbols-outlined spinning-icon">sync</span> Salvando...';
  btn.disabled = true;

  try {
    const res = await apiCall('editarSubTarefa', {
      idSub: idSub,
      descricao: descricao,
      responsavel: responsavel || 'Equipe Predial'
    });
    if (res.status === 'sucesso') {
      fecharModal('modal-editar-subtarefa');
      await carregarSubTarefasDaOS(osAbertaNoModal);
    } else {
      alert(res.mensagem || 'Erro ao editar sub-tarefa.');
    }
  } catch (e) {
    alert('Erro de rede ao editar sub-tarefa.');
  } finally {
    salvandoEdicaoSub = false;
    btn.innerHTML = 'Salvar Alterações';
    btn.disabled = false;
  }
}

async function deletarSubTarefa(idSub) {
  if (!confirm('Deseja excluir esta pendência?')) return;
  await apiCall('excluirSubTarefa', { idSub: idSub });
  await carregarSubTarefasDaOS(osAbertaNoModal);
}

async function concluirSubTarefa(idSub) {
  await apiCall('atualizarStatusSub', { idSub: idSub, novoStatus: 'Concluído' });
  await carregarSubTarefasDaOS(osAbertaNoModal);
}

async function reverterSubTarefa(idSub) {
  await apiCall('atualizarStatusSub', { idSub: idSub, novoStatus: 'Em Andamento' });
  await carregarSubTarefasDaOS(osAbertaNoModal);
}

// =========================================================================
// COMENTÁRIOS DE SUBTAREFAS (ADICIONAR, EDITAR E EXCLUIR SEPARADAMENTE)
// =========================================================================
function abrirModalNovoComentarioSub(idSub) {
  document.getElementById('titulo-modal-comentario').innerHTML = '<span class="material-symbols-outlined" style="color:var(--primary);">chat</span> Adicionar Comentário';
  document.getElementById('comentario-sub-id').value = idSub;
  document.getElementById('comentario-item-id').value = '';
  document.getElementById('texto-comentario-sub').value = '';

  const btn = document.getElementById('btn-salvar-comentario-sub');
  btn.textContent = 'Adicionar Comentário';
  btn.disabled = false;

  document.getElementById('modal-comentario-sub').classList.add('active');
  atualizarScrollBody();
}

function abrirModalEditarComentarioSub(idSub, idComentario) {
  const sub = subTarefasAtuais.find(s => s.idSub === idSub);
  if (!sub || !sub.comentarios) return;
  const com = sub.comentarios.find(c => String(c.id) === String(idComentario));
  if (!com) return;

  document.getElementById('titulo-modal-comentario').innerHTML = '<span class="material-symbols-outlined" style="color:var(--primary);">edit</span> Editar Comentário';
  document.getElementById('comentario-sub-id').value = idSub;
  document.getElementById('comentario-item-id').value = com.id;
  document.getElementById('texto-comentario-sub').value = com.texto || '';

  const btn = document.getElementById('btn-salvar-comentario-sub');
  btn.textContent = 'Salvar Comentário';
  btn.disabled = false;

  document.getElementById('modal-comentario-sub').classList.add('active');
  atualizarScrollBody();
}

async function salvarComentarioSubTarefa() {
  if (salvandoComentario) return;

  const idSub = document.getElementById('comentario-sub-id').value.trim();
  const idComentario = document.getElementById('comentario-item-id').value.trim();
  const texto = document.getElementById('texto-comentario-sub').value.trim();

  if (!texto) {
    alert('Digite o texto do comentário.');
    return;
  }

  const btn = document.getElementById('btn-salvar-comentario-sub');
  const acao = idComentario ? 'editarComentarioSub' : 'adicionarComentarioSub';

  salvandoComentario = true;
  btn.innerHTML = '<span class="material-symbols-outlined spinning-icon">sync</span> Salvando...';
  btn.disabled = true;

  try {
    const res = await apiCall(acao, {
      idSub: idSub,
      idComentario: idComentario,
      texto: texto,
      autor: usuarioAdmin ? usuarioAdmin.nome : 'Administrador'
    });
    if (res.status === 'sucesso') {
      fecharModal('modal-comentario-sub');
      await carregarSubTarefasDaOS(osAbertaNoModal);
    } else {
      alert(res.mensagem || 'Erro ao salvar comentário.');
    }
  } catch (e) {
    alert('Erro de comunicação ao salvar comentário.');
  } finally {
    salvandoComentario = false;
    btn.textContent = idComentario ? 'Salvar Comentário' : 'Adicionar Comentário';
    btn.disabled = false;
  }
}

async function excluirComentarioSubTarefa(idSub, idComentario) {
  if (!confirm('Deseja excluir este comentário?')) return;
  const res = await apiCall('excluirComentarioSub', { idSub: idSub, idComentario: idComentario });
  if (res.status === 'sucesso') {
    await carregarSubTarefasDaOS(osAbertaNoModal);
  } else {
    alert(res.mensagem || 'Erro ao excluir comentário.');
  }
}

async function carregarSubTarefasDaOS(idOS) {
  const lista = document.getElementById('lista-sub-tarefas');
  lista.innerHTML = `<div class="spinner"></div>`;
  try {
    const res = await apiCall('getSubTarefas', { idOS: idOS });
    subTarefasAtuais = res.dados || [];
    renderizarSubTarefas(subTarefasAtuais);
  } catch (e) {
    lista.innerHTML = `<p style="font-size:0.8rem; color:var(--status-urgente);">Erro ao carregar pendências.</p>`;
  }
}

function renderizarSubTarefas(subs) {
  const lista = document.getElementById('lista-sub-tarefas');
  lista.innerHTML = '';
  if (subs.length === 0) {
    lista.innerHTML = `<p style="font-size:0.8rem; color:var(--text-muted);">Sem pendências cadastradas.</p>`;
    return;
  }

  subs.forEach(s => {
    const isC = String(s.status || '').toUpperCase().includes('CONCLUÍDO');
    const temComentarios = Array.isArray(s.comentarios) && s.comentarios.length > 0;

    let html = `
      <div class="sub-task-item animate-hover" style="border-left: 4px solid ${isC ? 'var(--status-concluido)' : 'var(--status-andamento)'}; ${temComentarios ? 'margin-bottom:0; border-bottom-left-radius:0; border-bottom-right-radius:0;' : ''}">
        <div class="sub-task-info">
          <strong style="color:${isC ? 'var(--status-concluido)' : 'inherit'};">${s.descricao}</strong><br>
          <span style="font-size:0.78rem; color:var(--text-muted);">👤 ${s.responsavel || 'Equipe Predial'} | 📊 ${s.status}</span>
        </div>
        <div class="sub-task-actions admin-only">
          <button type="button" class="btn-sub-acao animate-pop" title="Adicionar Comentário" onclick="abrirModalNovoComentarioSub('${s.idSub}')"><span class="material-symbols-outlined" style="font-size:16px;">chat</span></button>
          <button type="button" class="btn-sub-acao animate-pop" title="Editar Sub-Tarefa" onclick="abrirModalEditarSubTarefa('${s.idSub}')"><span class="material-symbols-outlined" style="font-size:16px;">edit</span></button>
          ${!isC
            ? `<button type="button" class="btn-sub-acao ok animate-pop" title="Concluir Sub-Tarefa" onclick="concluirSubTarefa('${s.idSub}')"><span class="material-symbols-outlined" style="font-size:16px;">check</span></button>`
            : `<button type="button" class="btn-sub-acao reverter animate-pop" title="Reabrir Sub-Tarefa" onclick="reverterSubTarefa('${s.idSub}')"><span class="material-symbols-outlined" style="font-size:16px;">undo</span></button>`}
          <button type="button" class="btn-sub-acao del animate-pop" title="Excluir Sub-Tarefa" onclick="deletarSubTarefa('${s.idSub}')"><span class="material-symbols-outlined" style="font-size:16px;">delete</span></button>
        </div>
      </div>
    `;

    if (temComentarios) {
      html += `<div class="sub-comentarios-box">`;
      s.comentarios.forEach(c => {
        const dataCom = c.data ? ` <span style="color:var(--text-muted); font-size:0.72rem;">(${formatarDataBR(c.data)})</span>` : '';
        html += `
          <div class="comentario-linha">
            <div class="comentario-texto">
              <strong>${c.autor || 'Admin'}:</strong> ${c.texto}${dataCom}
            </div>
            <div class="comentario-acoes admin-only">
              <button type="button" class="btn-mini-acao animate-pop" title="Editar Comentário" onclick="abrirModalEditarComentarioSub('${s.idSub}', '${c.id}')">
                <span class="material-symbols-outlined" style="font-size:15px;">edit</span>
              </button>
              <button type="button" class="btn-mini-acao del animate-pop" title="Excluir Comentário" onclick="excluirComentarioSubTarefa('${s.idSub}', '${c.id}')">
                <span class="material-symbols-outlined" style="font-size:15px;">delete</span>
              </button>
            </div>
          </div>
        `;
      });
      html += `</div>`;
    }

    lista.innerHTML += html;
  });
}

// =========================================================================
// SCROLL ESTÁVEL DOS CARDS SUPERIORES (SEM CORTAR PESQUISA EM LANDSCAPE)
// =========================================================================
let ultimoScroll = window.scrollY;
let ticking = false;
window.addEventListener('scroll', () => {
  if (!ticking) {
    window.requestAnimationFrame(() => {
      const isLandscapeMobile = window.innerHeight <= 520 && window.innerWidth > window.innerHeight;
      if (isLandscapeMobile) {
        document.body.classList.remove('hide-cards');
        ticking = false;
        return;
      }

      const atualScroll = window.scrollY;
      if (atualScroll < 80) {
        document.body.classList.remove('hide-cards');
      } else {
        if (atualScroll > ultimoScroll + 40) document.body.classList.add('hide-cards');
        else if (atualScroll < ultimoScroll - 40) document.body.classList.remove('hide-cards');
      }
      ultimoScroll = atualScroll > 0 ? atualScroll : 0;
      ticking = false;
    });
    ticking = true;
  }
});

verificarSessao();