/**
 * Every string the app shows, in Brazilian Portuguese.
 *
 * Typed against `en.ts`, so this file must answer for every key: adding a
 * string in English without one here does not compile. Unit, faction, ability
 * and upgrade names are absent on purpose — those stay in the game’s own
 * words, which for Warhammer means English. See `game.ts`.
 */
import type { EN } from './en.ts';

export const PT: Record<keyof typeof EN, string> = {
  'nav.units': 'Unidades',
  'nav.plans': 'Planos',
  'nav.teams': 'Equipes',
  'nav.upgrades': 'Melhorias',
  'nav.badges': 'Emblemas',
  'nav.player': 'Dados do jogador',
  'shell.power': '{name} · poder {power}',
  'shell.refresh': 'Atualizar',
  'shell.refreshing': 'Atualizando…',
  'shell.refreshHint': 'Buscar a tropa na API agora, ignorando a cópia salva',
  'shell.refreshFailed': 'Falha ao atualizar',
  'shell.loadingDb': 'Carregando o banco de dados do jogo…',
  'shell.justNow': 'agora mesmo',
  'shell.minutesAgo': 'há {n}min',
  'shell.hoursAgo': 'há {n}h',
  'shell.daysAgo': 'há {n}d',
  'shell.syncedTitle': 'Dados do jogo de {synced}\nBuscados em {got}',
  'shell.unknown': 'desconhecido',

  /* ---- idioma --------------------------------------------------------- */
  'lang.heading': 'Idioma',
  'lang.blurb':
    'Os nomes de unidades, facções, habilidades e melhorias permanecem como o jogo os publica, em inglês, nos dois idiomas — um nome traduzido seria um nome que você não acharia no seu próprio jogo.',
  'lang.pt': 'Português (Brasil)',
  'lang.en': 'English',

  /* ---- unidades ------------------------------------------------------- */
  'units.byStatus': 'Por status',
  'units.byFaction': 'Por facção',
  'units.search': 'Buscar unidades ou facções…',
  'units.available': 'disponíveis',
  'units.inProgress': 'em progresso',
  'units.notStarted': 'não iniciadas',
  'units.noMatch': 'Nenhuma unidade corresponde a “{query}”.',
  'units.factionProgress': '{owned}/{total} disponíveis',
  'units.status.owned': 'Disponíveis',
  'units.status.unlockable': 'Fragmentos reunidos',
  'units.status.locked': 'Não iniciadas',
  'card.level': 'Nv {n}',
  'card.rank': 'Rank {n}',
  'card.shards': '{n} fragmentos',
  'card.locked': 'Bloqueada',
  'card.machineOfWar': 'Máquina de Guerra',

  /* ---- emblemas ------------------------------------------------------- */
  'badges.none': 'Nenhum emblema de habilidade no seu inventário.',
  'badges.nextOnly': 'Só o próximo nível',
  'badges.everyLevel': 'Todos os níveis que cobre',
  'badges.blurb':
    'Emblemas pertencem a uma grande aliança, não a uma unidade — por isso o jogo não sabe dizer onde usar um: a resposta é toda habilidade de toda unidade daquele lado. Aqui aparecem apenas as habilidades cujos níveis restantes realmente cobram aquela raridade, com o custo de cada nível. Uma habilidade aparece em mais de uma raridade quando sua escada cruza de uma para a outra.',
  'badges.held': '{n} em mãos',
  'badges.name': 'Emblemas {rarity} {alliance}',
  'badges.nothingToSpend': 'ainda não há onde gastar',
  'badges.upgradeCount': '{n} melhoria de habilidade',
  'badges.upgradeCountPlural': '{n} melhorias de habilidade',
  'badges.abilityCount': '{n} habilidade',
  'badges.abilityCountPlural': '{n} habilidades',
  'badges.needNext': '{n}× para o próximo nível de cada',
  'badges.needAll': '{n}× para completar todos os níveis',
  'badges.short': ' · faltam {n}',
  'badges.allMaxed':
    'Toda habilidade deste lado está em um nível que esta raridade não paga, ou já está no máximo.',
  'badges.levelStep': 'nível {from} → {to}',
  'badges.levelRange': 'níveis {from} → {to}',
  'badges.runningTotal': 'Total acumulado se você gastar seguindo esta lista na ordem',
  'badges.pooled':
    'Emblemas são compartilhados, então o total acumulado é o que uma ordem de gasto consumiria. As linhas depois de passar de {owned} ficam esmaecidas: é o que seu estoque não alcança.',
  'badges.stepCost': '{from}→{to}: {badges}× + {gold} de ouro',
  'slot.active': 'Ativa',
  'slot.passive': 'Passiva',
  'slot.mythic': 'Mítica',

  /* ---- melhorias ------------------------------------------------------ */
  'upg.tab.where': 'Onde usar os materiais',
  'upg.tab.nextRank': 'Próximo rank por unidade',
  'upg.filter.stock': 'Em estoque',
  'upg.filter.stockHint': 'Materiais dos quais você tem pelo menos um',
  'upg.filter.all': 'Todos os materiais',
  'upg.filter.allHint': 'A tabela inteira, tendo ou não',
  'upg.filter.unused': 'Ninguém usa',
  'upg.filter.unusedHint': 'Nenhum rank do jogo pede estes',
  'upg.scope.now': 'Dá para usar agora',
  'upg.scope.nowHint': 'Espaços vazios em unidades que já estão naquele rank',
  'upg.scope.ahead': 'Ainda pela frente',
  'upg.scope.aheadHint': 'Suas unidades, em ranks que ainda não alcançaram',
  'upg.scope.roster': 'Sua tropa',
  'upg.scope.rosterHint': 'Suas unidades, em todos os ranks, inclusive os já passados',
  'upg.scope.everyone': 'Todas as unidades',
  'upg.scope.everyoneHint': 'O jogo inteiro, tendo ou não a unidade',
  'upg.search': 'Buscar materiais…',
  'upg.count.spendable': 'dá para usar agora',
  'upg.count.stock': 'em estoque',
  'upg.count.known': 'conhecidos',
  'upg.blurb':
    'O jogo marca um material como “usado para subir de rank” sem dizer por quem. Isto é a tabela de ranks lida ao contrário. Um material conta como usado tanto se o rank o pede diretamente quanto se ele é forjado em algo que é pedido — então um componente várias receitas abaixo ainda mostra os ranks que acaba servindo, com a cadeia que leva até lá e a quantidade multiplicada ao longo dela. Por padrão o recorte é o que você pode usar hoje — uma unidade parada naquele rank com aquele espaço de melhoria ainda vazio — porque é a parte em que dá para agir sem esperar nada. Amplie com os botões acima para ver os ranks à frente, ou o jogo inteiro.',
  'upg.noMatch': 'Nada corresponde a “{query}”.',
  'upg.slotsOpen': '{n} espaço livre agora',
  'upg.slotsOpenPlural': '{n} espaços livres agora',
  'upg.slotsOpenHint': 'Espaços vazios agora em unidades que já estão naquele rank',
  'upg.slotsOpenNoneHeld': 'Há espaços livres para ele, mas você não tem nenhum',
  'upg.forged': 'Forjado',
  'upg.forgedHint': 'Nenhum nó de campanha derruba isto; tem de ser forjado.',
  'upg.nothingNeeds': 'nada no recorte atual precisa disto',
  'upg.unitCount': '{n} unidade',
  'upg.unitCountPlural': '{n} unidades',
  'upg.noUses':
    'Nada no recorte atual consome isto, nem direto nem por receita. Amplie o recorte para ver se alguma unidade que você não tem, ou um rank que você já passou, chega a pedir.',
  'upg.fitsNow': 'cabe agora',
  'upg.alreadyFitted': 'já encaixado',
  'upg.rankPassed': 'rank já passado',
  'upg.directly': 'direto',
  'upg.via': 'via {chain}',
  'upg.needsLevel': 'precisa de até nível {n}',
  'upg.levelHint':
    'A segunda fileira de melhorias de um rank tem trava de nível por melhoria, e só o limite mais alto do rank é publicado — então este espaço ainda pode estar esperando níveis.',
  'upg.gain': '+{n} de {stat}',
  'upg.noRanksLeft': 'Nenhuma unidade sua tem rank restante a alcançar.',
  'upg.nextRankBlurb':
    'Tudo o que mais um rank custa a cada unidade, materiais principais e suas receitas juntos, do mais barato ao mais caro. Espaços já preenchidos no rank atual aparecem como aplicados — esses materiais foram gastos e não podem ser movidos, então contam como feitos, não como algo a buscar. Só a falta é aberta em receita: o que já está em mãos não precisa ser feito.',
  'upg.ready': 'Pronto',
  'upg.missing': 'faltam {n}',
  'upg.appliedCount': '{n}× já aplicados',
};
