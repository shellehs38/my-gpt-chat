// Source-backed additional facade systems. Numeric project norms are deliberately not universal.
const checked='2026-10-25';
const ref=(title,url,pages)=>({title,url,checked,...(pages?{pages}:{})});
const n=(id,label,def='',help='')=>({id,label,type:'number',default:def,...(help?{help}:{})});
const t=(id,label,def='',help='')=>({id,label,type:'text',default:def,...(help?{help}:{})});
const perPiece=(id)=>n(id,'Шаг закупки, шт. (1 — поштучно)','1');
const workOnly=(id,name)=>({id,name,unit:'м²',mode:'area',material:false,workName:name});
const basic={systemKind:'panel',coverage:'area',manual:true,grid:false,usefulWidth:'',fullWidth:'',minLength:'',maxLength:'',orientations:['horizontal','vertical']};
const projectNormHelp='Введите расход из ведомости конкретного объекта и укажите документ. Площадь не определяет шаг, сечение или количество креплений.';
const alfasource=ref('АЛЬФА-ПРОФ: альбом АЛЬФА-Керамогранит, Королёв, 2018','https://alfa-nvf.ru/f/alfa_kg_150119.pdf','1.1–1.3; разделы конструкций, утепления и примыканий');
const altsource=ref('Альтернатива: альбом АЛЬТ-ФАСАД-07, 2015','https://alt-volga.ru/upload/iblock/80a/%D0%90%D0%BB%D1%8C%D0%B1%D0%BE%D0%BC%20%D1%82%D0%B5%D1%85%D0%BD%D0%B8%D1%87%D0%B5%D1%81%D0%BA%D0%B8%D1%85%20%D1%80%D0%B5%D1%88%D0%B5%D0%BD%D0%B8%D0%B9.pdf','3–5, 6–14; узлы альбома');
const hauberkSource=ref('ТЕХНОНИКОЛЬ: инструкция HAUBERK, редакция 08.2024','https://www.tn.ru/upload/iblock/6ff/f3ohl6fkuxk4xnrgtczmj0yvta2ylpar/instruction-Hauberk_110x200_08_2024.pdf','38–45, 46–63; выбран способ по деревянному основанию');
const hauberkProduct=ref('ТЕХНОНИКОЛЬ: HAUBERK КИРПИЧ, технический лист 5.39, 06.2025','https://www.tn.ru/upload/iblock/52b/zrefi6xvhua1is32u797yk2te6pxrcdf/Tekhlist-5_39_Fasadnaya-plitka-TEKHNONIKOL-HAUBERK_-kollektsiya-KIRPICH_RU_ru.pdf','1–2');

function ventFields(insulated){return [
  t('panelGrade','Марка, формат и толщина облицовки по раскладке'),
  n('panelPack','Площадь в упаковке облицовки, м²'),
  t('frameSpec','Проектная спецификация подсистемы: профили, металл, узлы'),
  n('railsNorm','Вертикальные направляющие по проекту, м.п./м²','',projectNormHelp),n('railsPack','Длина закупочной единицы вертикальных направляющих, м.п.'),
  n('horizontalRailsNorm','Горизонтальные направляющие перекрёстной подсистемы, м.п./м²','',projectNormHelp),n('horizontalRailsPack','Длина закупочной единицы горизонтальных направляющих, м.п.'),
  n('bracketsQty','Кронштейны по проекту, шт.'),perPiece('bracketsPack'),
  n('anchorsQty','Анкеры кронштейнов по проекту, шт.'),perPiece('anchorsPack'),
  n('thermalPadsQty','Терморазрывы под кронштейны по проекту, шт.'),perPiece('thermalPadsPack'),
  n('frameFastenersQty','Заклёпки / винты соединений каркаса по спецификации, шт.'),perPiece('frameFastenersPack'),
  n('holdersNorm','Кляммеры / держатели по раскладке, шт./м²','',projectNormHelp),perPiece('holdersPack'),
  t('holdersSpec','Источник марки и нормы держателей облицовки'),
  n('trimsQty','Обрамления, рассечки и доборные детали по спецификации, м.п.'),n('trimsPack','Длина закупочной единицы доборных деталей, м.п.'),
  ...(insulated?[
    t('insulationGrade','Утеплитель: проектная марка и характеристика плиты'),
    t('insulationSpec','Проектный источник утепления, толщины и крепления'),
    n('insulationThickness','Толщина отдельного слоя утепления, мм'),
    n('insulationPack','Упаковка плиты первого / единственного слоя, м³'),n('insulationReserve','Запас первого / единственного слоя, %','0'),
    t('insulationGrade2','Второй наружный слой: проектная марка и характеристика плиты'),n('insulationThickness2','Толщина второго наружного слоя, мм'),n('insulationPack2','Упаковка плиты второго наружного слоя, м³'),n('insulationReserve2','Запас второго наружного слоя, %','0'),
    n('insulationFixingsNorm','Дюбели утеплителя по проектной схеме, шт./м²'),perPiece('insulationFixingsPack'),
    n('membraneNorm','Мембрана с проектными нахлёстами, м²/м²'),n('membranePack','Площадь рулона мембраны, м²'),t('membraneSpec','Основание включения и расхода мембраны')
  ]:[])
];}
function ventAssembly(panelName,insulated){return [
  workOnly('inspection','Подготовка и проверка основания по проекту НФС'),
  {id:'brackets',name:'Кронштейны выбранной НФС',unit:'шт.',mode:'manual',quantityKey:'bracketsQty',packKey:'bracketsPack',sourceKey:'frameSpec',identityKeys:['frameSpec'],workName:'Монтаж кронштейнов НФС'},
  {id:'anchors',name:'Анкеры кронштейнов по проекту',unit:'шт.',mode:'manual',quantityKey:'anchorsQty',packKey:'anchorsPack',sourceKey:'frameSpec',identityKeys:['frameSpec']},
  {id:'thermal-pads',name:'Проектные теплоизолирующие прокладки кронштейнов',unit:'шт.',mode:'manual',quantityKey:'thermalPadsQty',packKey:'thermalPadsPack',sourceKey:'frameSpec',identityKeys:['frameSpec']},
  ...(insulated?[
    {id:'insulation',name:'Теплоизоляционные плиты НФС — марка по проекту',unit:'м³',mode:'insulationVolume',thicknessKey:'insulationThickness',sourceKey:'insulationSpec',reserveKey:'insulationReserve',packKey:'insulationPack',identityKeys:['insulationGrade'],workName:'Монтаж отдельного слоя теплоизоляции НФС',techNote:'Марка и характеристики должны соответствовать проекту и допускам всей НФС. Это не утеплитель СФТК. Для двухслойного решения включите второй наружный слой, не заменяйте два материала одной общей толщиной без раскладки.'},
    {id:'insulation-outer',name:'Второй наружный слой теплоизоляции НФС — по проекту',unit:'м³',mode:'insulationVolume',thicknessKey:'insulationThickness2',sourceKey:'insulationSpec',reserveKey:'insulationReserve2',packKey:'insulationPack2',identityKeys:['insulationGrade2'],workName:'Монтаж второго наружного слоя теплоизоляции НФС',optional:true,enabledDefault:false,techNote:'Включается только при двухслойном проектном решении. Стыки смещают; роль наружной плиты и совместимость с первым слоем подтверждаются проектом.'},
    {id:'insulation-fixings',name:'Тарельчатые дюбели состава утепления НФС',unit:'шт.',mode:'norm',normKey:'insulationFixingsNorm',sourceKey:'insulationSpec',packKey:'insulationFixingsPack',identityKeys:['insulationSpec']},
    {id:'membrane',name:'Проектная ветровлагозащитная мембрана',unit:'м²',mode:'norm',normKey:'membraneNorm',sourceKey:'membraneSpec',packKey:'membranePack',workName:'Монтаж предусмотренной проектом мембраны',optional:true,enabledDefault:false,techNote:'Включается только при наличии в проекте и документах применяемой системы; горючесть и противопожарные решения проверяют отдельно.'}
  ]:[]),
  {id:'horizontal-rails',name:'Горизонтальные направляющие перекрёстной подсистемы',unit:'м.п.',mode:'norm',normKey:'horizontalRailsNorm',sourceKey:'frameSpec',packKey:'horizontalRailsPack',identityKeys:['frameSpec'],workName:'Монтаж горизонтальных направляющих перекрёстной подсистемы',optional:true,enabledDefault:false,techNote:'Включить, если выбрана горизонтально-вертикальная система. Её профиль, метраж и цена отделены от вертикальных направляющих.'},
  {id:'rails',name:'Вертикальные направляющие подсистемы по раскладке',unit:'м.п.',mode:'norm',normKey:'railsNorm',sourceKey:'frameSpec',packKey:'railsPack',identityKeys:['frameSpec'],workName:'Монтаж направляющих и выверка плоскости НФС'},
  {id:'frame-fasteners',name:'Соединительный крепёж подсистемы',unit:'шт.',mode:'manual',quantityKey:'frameFastenersQty',packKey:'frameFastenersPack',sourceKey:'frameSpec',identityKeys:['frameSpec']},
  {id:'holders',name:'Держатели / кляммеры выбранной облицовки',unit:'шт.',mode:'norm',normKey:'holdersNorm',sourceKey:'holdersSpec',packKey:'holdersPack',identityKeys:['holdersSpec']},
  {id:'panels',name:panelName,unit:'м²',mode:'area',coverage:true,packKey:'panelPack',identityKeys:['panelGrade'],workName:'Монтаж облицовки по проектной раскладке',techNote:'Цена материала — за м². Площадь без запаса — геометрия; закупка — после раскладки, резки и упаковки. Площадь не заменяет карту раскроя.'},
  {id:'trims',name:'Обрамления, противопожарные и доборные детали по проекту',unit:'м.п.',mode:'manual',quantityKey:'trimsQty',sourceKey:'frameSpec',packKey:'trimsPack',identityKeys:['frameSpec'],workName:'Монтаж проектных обрамлений и доборов',workMode:'manual',workQuantityKey:'trimsQty',workUnit:'м.п.',techNote:'Состав и общий метраж берутся из спецификации: не подставляйте автоматически углы сайдинга.'}
];}
const ventHints=[
  'Каркас считается по проектной спецификации, а не по универсальной сетке стены: формат панелей, стыки и зоны ветровой нагрузки меняют раскладку.',
  'Заполните марку / формат облицовки, профиль подсистемы и источники норм. Для перекрёстного каркаса включите отдельные горизонтальные направляющие; их цену не смешивайте с вертикальным профилем.',
  'Для двухслойного утепления включите второй наружный слой и задайте обе марки, толщины и упаковки. Стыки смещают по проекту; общая норма крепежа должна покрывать выбранный состав без двойного учёта.',
  'Цена облицовки здесь задаётся за м²; кронштейны и анкеры — поштучно; направляющие и доборы — в погонных метрах.'
];
const ventLimits=[
  'Прочность основания, анкеры, шаги, вылеты и допустимые нагрузки определяются проектом и испытаниями для выбранной системы.',
  'Перед применением проверьте действующую документацию, техническое свидетельство, пожарные требования и совместимость всех компонентов; старый альбом не подтверждает актуальный допуск.',
  'Схемы крепления одной марки плит, кляммеров или НФС не переносятся на другую. Отверстия, резка и швы — по документации облицовки.',
  'Вентиляционный зазор и водоотвод не перекрывают. Наружные элементы, вывески и оборудование требуют собственных проектных узлов.'
];
const porcelainMount=[
  'Обследовать и снять геометрию основания; сверить проект с раскладкой плит, узлами примыкания и результатами испытаний креплений.',
  'Разметить проектные кронштейны, выполнить крепление анкерами и предусмотренными теплоизолирующими прокладками. Сечения и шаги не назначаются по площади фасада.',
  'Если выбран утеплённый вариант, смонтировать проектные плиты и их крепёж; мембрану включать только когда она предусмотрена системой.',
  'Собрать предусмотренную проектом вертикальную, горизонтально-вертикальную или межэтажную подсистему и выверить плоскость.',
  'Установить соответствующие стартовые и рядовые кляммеры; крепить керамогранит видимым способом по марке и формату плит, с проектными швами и компенсацией деформаций.',
  'Выполнить проектные откосы, отливы, примыкания и противопожарные детали; проверить крепление, плоскость, зазоры и исполнительную документацию.'
];
const terracottaMount=[
  'Подтвердить проект НФС АЛЬТ-ФАСАД-07, конкретный тип пустотной керамической плиты и соответствующие держатели: КТ, КТ-К, зацепы либо шину предусмотренного варианта.',
  'Выполнить разбивку, монтаж проектных анкеров, кронштейнов и теплоизолирующих прокладок с проверкой основания; универсальный шаг не назначать.',
  'При утеплённом варианте установить выбранные проектом плиты и тарельчатые дюбели. Не переносить числа креплений на плиту из альбома в норму на м² без формата и схемы.',
  'Собрать вертикальную либо межэтажную подсистему в выбранном исполнении; обеспечить требуемую геометрию и вентиляционный зазор.',
  'Монтировать плитку на предусмотренные держатели с пружинными подпорками и декоративными профилями там, где они заданы узлом. Разные виды плит / держателей не смешивать.',
  'Выполнить примыкания, обрамления и проектные противопожарные решения; проверить посадку плит, удержание, швы, водоотвод и доступные контрольные узлы.'
];
function ventVariants(systemId,manufacturer,name,mounting,sources){return [false,true].map(insulated=>({
  ...basic,mountingMethods:['frame'],systemId,id:`${systemId}-${insulated?'insulated':'bare'}`,manufacturer,name:`${name} — ${insulated?'с проектным утеплением':'без утепления'}`,
  scenarioMode:insulated?'insulated':'bare',constructionType:'ventilated',assemblyTitle:name,
  assemblyFields:ventFields(insulated),assembly:ventAssembly(name,insulated),assemblyHints:ventHints,
  mounting,accessories:['Кронштейны, анкеры, терморазрывы, направляющие и соединительный крепёж выбранной НФС.','Штатные держатели выбранной облицовки, проектные обрамления и водоотвод.','Утеплитель и мембрана только в предусмотренном проектом составе.'],
  limitations:ventLimits,sources
}));}

const brickGuide=ref('BRAER: технология кладки кирпича','https://braer.ru/blog/tekhnologiya-kladki-kirpicha/');
const brickProduct=ref('BRAER: облицовочный кирпич формата 250×120×65 мм','https://braer.ru/barnaul/catalog/oblitsovochnyy-kirpich/filter/collection-is-250-120-65/apply/');
const brick={
  ...basic,systemId:'facing-brick',systemKind:'masonry',coverage:'masonry',id:'braer-facing-brick-1nf',manufacturer:'BRAER',name:'Облицовочная кладка BRAER — формат по паспорту (предустановлен 1 НФ)',scenarioMode:'bare',constructionType:'project',
  assemblyTitle:'Облицовочная кирпичная кладка',
  assemblyFields:[n('brickLength','Длина кирпича, мм','250','Формат выбранной карточки BRAER: 250×120×65 мм. Для другого формата исправьте размеры по паспорту.'),n('brickHeight','Высота кирпича, мм','65'),n('jointWidth','Вертикальный кладочный шов, мм','','По проекту. Статья BRAER описывает диапазон 8–12 мм; значение не назначено автоматически.'),n('jointHeight','Горизонтальный кладочный шов, мм','','По проекту; шов должен быть постоянным на выбранном участке кладки.'),n('brickPack','Кирпичей в закупочной единице, шт.','1','1 означает покупку поштучно; для целого поддона укажите число кирпичей из паспорта партии.'),t('brickGrade','Коллекция и марка кирпича по заказу'),t('masonrySpec','Проект кладки, опор, связей и проёмов'),n('mortarNorm','Кладочная смесь по выбранному кирпичу и шву, кг/м²'),n('mortarPack','Масса мешка кладочной смеси, кг'),t('mortarSpec','Источник расхода и марки кладочной смеси'),n('tiesNorm','Связи облицовочной кладки по проекту, шт./м²'),perPiece('tiesPack'),t('tiesSpec','Источник марки и проектной нормы связей'),n('supportsQty','Опорные элементы / консоли / перемычки по проекту, шт.'),perPiece('supportsPack'),n('waterproofQty','Гидроизоляция опорного узла по проекту, м²'),n('waterproofPack','Площадь закупочной единицы гидроизоляции, м²')],
  assembly:[workOnly('inspection','Подготовка основания и проверка опор облицовочной кладки'),{id:'supports',name:'Опоры и перемычки облицовки по проекту',unit:'шт.',mode:'manual',quantityKey:'supportsQty',sourceKey:'masonrySpec',packKey:'supportsPack',identityKeys:['masonrySpec'],workName:'Устройство проектных опор и перемычек облицовки',workMode:'manual',workQuantityKey:'supportsQty',workUnit:'шт.'},{id:'waterproofing',name:'Гидроизоляция опорного узла облицовочной кладки',unit:'м²',mode:'manual',quantityKey:'waterproofQty',sourceKey:'masonrySpec',packKey:'waterproofPack',workName:'Гидроизоляция опорного узла',workMode:'manual',workQuantityKey:'waterproofQty'},
    {id:'brick',name:'Облицовочный кирпич BRAER — формат по введённым размерам',unit:'шт.',mode:'masonry',lengthKey:'brickLength',heightKey:'brickHeight',jointWidthKey:'jointWidth',jointHeightKey:'jointHeight',coverage:true,packKey:'brickPack',identityKeys:['brickGrade'],workName:'Облицовочная кладка кирпича с заполнением и оформлением швов'},
    {id:'mortar',name:'Кладочная смесь по кирпичу, толщине кладки и швам',unit:'кг',mode:'norm',normKey:'mortarNorm',sourceKey:'mortarSpec',packKey:'mortarPack',identityKeys:['mortarSpec']},
    {id:'ties',name:'Связи облицовочной кладки по проекту',unit:'шт.',mode:'norm',normKey:'tiesNorm',sourceKey:'tiesSpec',packKey:'tiesPack',identityKeys:['tiesSpec']}],
  assemblyHints:['Количество кирпича = чистая площадь / ((длина + вертикальный шов) × (высота + горизонтальный шов)); миллиметры переводятся в метры. После этого учитываются запас и округление до закупочной единицы.','Это предварительная кладка в один облицовочный слой; для предустановленного формата 1 НФ ширина кирпича 120 мм. Перевязка, углы, простенки и резка уточняются по раскладке. Для другого формата и способа кладки нужны свои размеры и проект.','Стоимость работы считается по чистой площади, без прибавления кирпичного запаса. Кладочная смесь и оформление швов не добавляются второй раз отдельной универсальной затиркой.'],
  mounting:['Проверить предусмотренную проектом несущую опору для лицевого слоя. Поверхность первого ряда выровнять и выполнить гидроизоляцию опорного узла.','Проверить партию, смешивать кирпичи из нескольких поддонов по рекомендациям поставки; выполнить предварительную раскладку и согласовать размеры швов.','Подобрать кладочную смесь по водопоглощению кирпича и условиям работ. Приготовление, жизнеспособность и температурные ограничения брать из её техкарты.','Вести кладку с проектной перевязкой, постоянной толщиной горизонтальных и вертикальных швов; соединение с основной стеной выполнять проектными связями и армированием.','Оформлять и уплотнять швы, не оставляя выступающих полок или открытых рёбер, способных накапливать воду. Сохранять проектные вентиляционные / дренажные отверстия и деформационные швы.','Защищать свежую кладку и незавершённый верх от осадков; очистку и уход выполнять совместимым способом, не повреждая лицевую поверхность.'],
  accessories:['Проектные опоры, гидроизоляция, связи, перемычки, армирование и деформационные узлы.','Совместимая кладочная смесь, проектные решения водоотвода и вентиляции.'],
  limitations:['Площадь фасада не подтверждает несущую способность фундамента или наличие опоры под облицовку; эти решения не назначаются калькулятором.','Статья BRAER содержит общие рекомендации, а не расчёт конкретного здания. Норма связей, опоры и прочностные решения должны подтверждаться проектом.','Размер 250×120×65 мм подтверждён выбранным форматом BRAER. Швы не предустановлены; для другого продукта и кладки исходные данные меняют по паспорту и раскладке.','Вариант не включает отдельное утепление; наличие вентиляционного зазора, утепления и противопожарных деталей определяется конструкцией стены.'],sources:[brickGuide,brickProduct]
};

function hauberkFields(newBase){return [t('tileColour','Цвет и партия HAUBERK КИРПИЧ'),n('tilePack','Площадь плитки в упаковке, м²','2','Технический лист 5.39, версия 06.2025: 2 м² / 20 гонтов. Для другой коллекции нужна её упаковка.'),n('nailsNorm','Гвозди крепления рядовой плитки, шт./м²','','Схема 8 гвоздей на гонт и ограниченно допустимая схема 5 гвоздей различаются. Укажите расход по выбранной раскладке, верхним/стартовым рядам и узлам.'),perPiece('nailsPack'),t('nailsSpec','Источник выбранной схемы и расхода гвоздей'),
  ...(newBase?[t('baseSpec','Проект обрешётки, настила и его крепления'),n('battensNorm','Деревянная обрешётка по проекту, м.п./м²'),n('battensPack','Длина закупочной единицы бруска, м.п.'),n('boardsNorm','Сплошной настил с раскроем, м²/м²'),n('boardsPack','Площадь листа настила, м²'),n('baseFixingsNorm','Крепёж настила по его паспорту и основанию, шт./м²'),perPiece('baseFixingsPack')]:[]),
  t('trimSpec','Проектная спецификация углов, откосов, отливов и их крепежа'),n('trimPack','Длина закупочной единицы металлических планок, м.п.'),n('trimFastenersQty','Крепёж планок по спецификации, шт.'),perPiece('trimFastenersPack'),n('starterExtraQty','Дополнительная плитка на старт и местные узлы, м²','','Указывать только ту добавку, которая не включена в основной запас; повторный учёт не допускается.')
];}
function hauberkAssembly(newBase){return [workOnly('inspection','Проверка ровного, сухого и жёсткого деревянного основания'),...(newBase?[
  {id:'battens',name:'Деревянная обрешётка основания HAUBERK',unit:'м.п.',mode:'norm',normKey:'battensNorm',sourceKey:'baseSpec',packKey:'battensPack',identityKeys:['baseSpec'],workName:'Монтаж проектной деревянной обрешётки'},
  {id:'boards',name:'Сплошной настил ОСП-3 / ФСФ под HAUBERK по проекту',unit:'м²',mode:'norm',normKey:'boardsNorm',sourceKey:'baseSpec',packKey:'boardsPack',identityKeys:['baseSpec'],workName:'Устройство сплошного деревянного настила',techNote:'В выбранном способе инструкция требует деревянный настил толщиной не менее 9 мм, сухой, ровный и жёсткий. Проверяют опоры, зазоры и паспорт листов.'},
  {id:'base-fixings',name:'Крепёж деревянного настила к обрешётке',unit:'шт.',mode:'norm',normKey:'baseFixingsNorm',sourceKey:'baseSpec',packKey:'baseFixingsPack',identityKeys:['baseSpec']}
]:[]),
  {id:'tiles',name:'Фасадная плитка ТЕХНОНИКОЛЬ HAUBERK КИРПИЧ',unit:'м²',mode:'area',coverage:true,packKey:'tilePack',identityKeys:['tileColour'],workName:'Монтаж фасадной плитки HAUBERK по деревянному основанию',techNote:'Цена — за м² готового покрытия. Заводской перехлёст уже учтён в площади покрытия упаковки; габарит гонта не подставляется как полезная площадь.'},
  {id:'nails',name:'Специальные оцинкованные гвозди HAUBERK по выбранной схеме',unit:'шт.',mode:'norm',normKey:'nailsNorm',sourceKey:'nailsSpec',packKey:'nailsPack',identityKeys:['nailsSpec']},
  {id:'starter-extra',name:'Дополнительная плитка на стартовую полосу и узлы сверх основного запаса',unit:'м²',mode:'manual',quantityKey:'starterExtraQty',packKey:'tilePack',optional:true,enabledDefault:false,techNote:'Не дублировать расход, уже заложенный в запас основной плитки; уточнить по раскладке стартовой полосы.'},
  {id:'outer-trims',name:'Штатные наружные угловые планки HAUBERK',unit:'м.п.',mode:'outerCorners',sourceKey:'trimSpec',packKey:'trimPack',workName:'Монтаж наружных угловых планок HAUBERK',workMode:'outerCorners',workUnit:'м.п.'},
  {id:'reveals',name:'Штатные планки откосов HAUBERK',unit:'м.п.',mode:'revealLength',optional:true,enabledDefault:false,sourceKey:'trimSpec',packKey:'trimPack',workName:'Монтаж планок откосов HAUBERK',workMode:'revealLength',workUnit:'м.п.'},
  {id:'sills',name:'Проектные оконные отливы HAUBERK',unit:'м.п.',mode:'sillLength',optional:true,enabledDefault:false,sourceKey:'trimSpec',packKey:'trimPack',workName:'Монтаж проектных оконных отливов',workMode:'sillLength',workUnit:'м.п.'},
  {id:'trim-fasteners',name:'Крепёж металлических планок HAUBERK',unit:'шт.',mode:'manual',quantityKey:'trimFastenersQty',sourceKey:'trimSpec',packKey:'trimFastenersPack'}
];}
const hauberkVariants=[true,false].map(newBase=>({...basic,systemId:'bitumen',id:`hauberk-brick-${newBase?'new-solid-base':'ready-solid-base'}`,manufacturer:'ТЕХНОНИКОЛЬ',name:`HAUBERK КИРПИЧ — ${newBase?'с устройством деревянного настила':'по готовому деревянному настилу'}`,scenarioMode:'bare',constructionType:'project',assemblyTitle:'Битумная фасадная плитка по деревянному основанию',assemblyFields:hauberkFields(newBase),assembly:hauberkAssembly(newBase),
  assemblyHints:['Выбран фасадный способ монтажа по деревянному основанию; схемы по XPS, кирпичу, бетону и металлу имеют другую технологию и сюда не перенесены.','Упаковка 2 м² относится только к коллекции КИРПИЧ из технического листа 06.2025. На другой коллекции измените комплект и паспорт упаковки.','Норму гвоздей задайте по выбранной схеме и проекту; крепления верхнего и нижнего ряда, стартовая полоса и дополнительные планки проверяются отдельно.',
  'Если на отделываемом участке есть проёмы, включите соответствующие позиции планок откосов и оконных отливов и заполните их замеры. На участке без проёмов эти позиции оставьте выключенными.'],
  mounting:['Проверить основание и возможность выбранного способа: сплошной, ровный, сухой и жёсткий настил ОСП-3 или ФСФ по инструкции и проекту. Для готового настила подтвердить его пригодность.','При устройстве нового основания выполнить проектную обрешётку и опирание листов; соблюсти толщину, крепёж, акклиматизацию и компенсационные зазоры листов из инструкции HAUBERK и паспорта настила.','Выполнить разметку фасада и раскладку; смешивать материал из нескольких упаковок. Удалять защитную плёнку с клеевого слоя перед фиксацией.','Сформировать стартовую полосу из рядовой плитки по рисунку инструкции. Учитывать дополнительный материал на неё один раз. Следующие ряды вести со смещением по разметке.','Закреплять плитку специальными гвоздями, не врезая шляпку в материал. Базовая схема 8 гвоздей на гонт и ограниченно допустимая схема 5 гвоздей не являются взаимозаменяемыми без проверки условий инструкции.','Оформить наружные углы, откосы, отливы и примыкания штатными планками; нахлёсты, точки крепления, мастику и локальное прогревание принимать по конкретному узлу и условиям работ.'],
  accessories:['Сплошной настил и его крепёж — только для варианта с устройством нового основания.','Специальные гвозди, штатные планки наружных углов, откосов, отливы и их крепления.','Дополнительные герметизирующие материалы — отдельной строкой по конкретному узлу, если они предусмотрены.'],
  limitations:['HAUBERK — битумосодержащая облицовка с пожарными характеристиками конкретной коллекции. Допустимость для здания и узлов проверяется по действующим требованиям и проекту.','В этой карточке нет самостоятельного утепления и нет универсальной металлической подсистемы. Готовый деревянный настил не считается автоматически пригодным без проверки.','Нельзя переносить расход крепежа деревянного основания на крепление к XPS, каменной стене или металлическому листу. Для других оснований нужна отдельная схема инструкции.','Нормы, температуры и зимние мероприятия применяют по действующей версии инструкции и проекту; расчёт площадей не подтверждает эти условия.'],sources:[hauberkSource,hauberkProduct]}));

export const extraSystems=[
  {id:'facing-brick',name:'Облицовочный кирпич',group:'masonry',kind:'masonry',description:'Отдельный лицевой слой кладки с опорой, гидроизоляцией и проектными связями. Количество кирпича зависит от формата и двух кладочных швов.',hints:['Опору и связи проверяют отдельно от основной стены. Размер кирпича не определяет норму раствора или прочность опоры.'],variants:[brick]},
  {id:'porcelain',name:'Керамогранитный фасад',group:'masonry',kind:'panel',description:'Навесной вентилируемый фасад с керамогранитом на штатных держателях и проектной подсистеме.',hints:ventHints,variants:ventVariants('porcelain','АЛЬФА-ПРОФ','АЛЬФА-Керамогранит, видимое крепление',porcelainMount,[alfasource])},
  {id:'terracotta',name:'Терракотовые керамические панели',group:'special',kind:'panel',description:'Пустотные керамические фасадные плиты на специальной навесной системе с воздушным зазором.',hints:ventHints,variants:ventVariants('terracotta','Альтернатива','АЛЬТ-ФАСАД-07, терракотовые плиты',terracottaMount,[altsource])},
  {id:'bitumen',name:'Битумная фасадная плитка',group:'special',kind:'panel',description:'HAUBERK по сплошному деревянному основанию: отдельные варианты нового и готового настила.',hints:['Это фасадная облицовка; кровельные уклоны и монтажные схемы не подставляются в фасадную смету.'],variants:hauberkVariants}
];
