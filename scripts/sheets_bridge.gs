// Cole esse código em: Extensões → Apps Script (dentro de CADA planilha)
// Depois: Implantar → Nova implantação → tipo "App da Web"
//   - Executar como: Eu (sua conta)
//   - Quem pode acessar: Qualquer pessoa
// Copie a URL gerada (termina em /exec) e me envie.

const SECRET = 'TROQUE_ESTE_TOKEN_POR_ALGO_SO_SEU';

function doGet(e) {
  if (e.parameter.token !== SECRET) return resposta({ erro: 'nao autorizado' });
  const nomeAba = e.parameter.aba;
  const linhaCabecalho = parseInt(e.parameter.linhaCabecalho || '1', 10);
  const planilha = SpreadsheetApp.getActiveSpreadsheet();
  const aba = planilha.getSheetByName(nomeAba);
  if (!aba) return resposta({ erro: 'aba nao encontrada: ' + nomeAba });

  if (e.parameter.opcoesColuna) {
    return resposta(obterOpcoesColuna(aba, e.parameter.opcoesColuna, linhaCabecalho));
  }

  const dados = aba.getDataRange().getValues();
  const cabecalho = dados[linhaCabecalho - 1];
  const linhas = dados.slice(linhaCabecalho)
    .map((linha, idx) => {
      const obj = { _linha: linhaCabecalho + idx + 1 };
      cabecalho.forEach((col, i) => { obj[col] = linha[i]; });
      return obj;
    })
    .filter(obj => Object.values(obj).some(v => v !== '' && v !== undefined));
  return resposta(linhas);
}

function doPost(e) {
  const body = JSON.parse(e.postData.contents);
  if (body.token !== SECRET) return resposta({ erro: 'nao autorizado' });
  const linhaCabecalho = parseInt(body.linhaCabecalho || 1, 10);
  const planilha = SpreadsheetApp.getActiveSpreadsheet();
  const aba = planilha.getSheetByName(body.aba);
  if (!aba) return resposta({ erro: 'aba nao encontrada: ' + body.aba });
  const cabecalho = aba.getDataRange().getValues()[linhaCabecalho - 1];

  if (body.action === 'append') {
    const linha = cabecalho.map(col => (body.dados[col] !== undefined ? body.dados[col] : ''));
    aba.appendRow(linha);
    return resposta({ ok: true });
  }
  if (body.action === 'update') {
    const linha = cabecalho.map(col => (body.dados[col] !== undefined ? body.dados[col] : ''));
    aba.getRange(body._linha, 1, 1, linha.length).setValues([linha]);
    return resposta({ ok: true });
  }
  if (body.action === 'delete') {
    aba.deleteRow(body._linha);
    return resposta({ ok: true });
  }
  return resposta({ erro: 'acao desconhecida' });
}

function obterOpcoesColuna(aba, nomeColuna, linhaCabecalho) {
  const cabecalho = aba.getDataRange().getValues()[linhaCabecalho - 1];
  const idx = cabecalho.indexOf(nomeColuna);
  if (idx === -1) return { erro: 'coluna nao encontrada: ' + nomeColuna };
  const numLinhas = aba.getLastRow() - linhaCabecalho;
  if (numLinhas <= 0) return [];
  const validacoes = aba.getRange(linhaCabecalho + 1, idx + 1, numLinhas, 1).getDataValidations();
  for (const linha of validacoes) {
    const regra = linha[0];
    if (regra && regra.getCriteriaType() === SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) {
      return regra.getCriteriaValues()[0];
    }
  }
  return [];
}

function resposta(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
