'use strict';

const app = document.querySelector('#app');
const toastRegion = document.querySelector('#toast-region');

const languages = [
  ['ka', 'ქართული'],
  ['en', 'English'],
  ['es', 'Español'],
  ['fr', 'Français'],
  ['de', 'Deutsch'],
  ['ru', 'Русский'],
  ['tr', 'Türkçe'],
  ['ar', 'العربية'],
  ['hi', 'हिन्दी'],
  ['zh', '中文']
];

const paymentNetworks = [];

const state = {
  lang: localStorage.getItem('taskmall_language') || 'ka',
  user: null,
  paymentsAvailable: false,
  paymentMode: '',
  withdrawalsAvailable: false,
  minimumWithdrawalAmount: 10,
  depositWallet: null,
  tasks: [],
  activities: [],
  vips: [],
  team: null,
  view: 'home',
  filter: 'all',
  search: '',
  sort: 'default',
  mobileMenu: false,
  activityPage: 1,
  authMode: 'signup',
  modalTaskId: null,
  walletModal: null,
  helpOpen: false,
  loading: true,
  busy: false
};

const en = {
  tagline: 'Tasks, VIP levels, and clear USDT balances',
  storyTitle: 'TaskMall keeps every balance in the right place.',
  storyText: 'Deposits go directly to the VIP account. Task rewards go to the withdrawal account.',
  story1: 'VIP account balance for purchases',
  story2: 'Task rewards credited separately',
  story3: 'Transfer rewards into VIP balance anytime',
  welcome: 'Welcome to TaskMall',
  authSubtitle: 'Create an account or continue where you left off.',
  signup: 'Sign up',
  signin: 'Sign in',
  fullName: 'Full name',
  fullNamePlaceholder: 'e.g. Alex Morgan',
  email: 'Email',
  emailPlaceholder: 'name@example.com',
  password: 'Password',
  passwordPlaceholder: 'At least 8 characters',
  confirmPassword: 'Confirm password',
  referral: 'Invite code',
  referralPlaceholder: 'Optional',
  createAccount: 'Create account',
  signInAction: 'Sign in',
  registerEmail: 'Register by Email',
  registerPhone: 'Register by phone',
  dashboardTicker: 'Transparency and sustainability powered by TaskMall',
  joinTitle: 'Come Join Us',
  joinText: 'Earn from simple daily tasks and grow your VIP balance with a clear wallet.',
  vipBadge: 'VIP',
  recharge: 'Recharge',
  inviteFriends: 'Invite Friends',
  agencyCooperation: 'Agency Cooperation',
  companyProfile: 'Company Profile',
  appPanelTitle: 'App',
  appPanelText: 'TaskMall mobile workspace',
  activitiesTitle: 'Activities',
  earnPitch: 'Earn USDT in just 10 minutes a day',
  navHome: 'Home',
  navTasks: 'Tasks',
  navVip: 'VIP',
  navTeam: 'Team',
  navMe: 'Me',
  greeting: (name) => `Hi, ${name.split(' ')[0]}`,
  heroTitle: 'Manage VIP funding and task rewards from one dashboard.',
  heroText: 'Deposited funds appear in the VIP account automatically. Use that balance to buy VIP packages, add more funds later, or transfer task rewards into the VIP account.',
  lockedAccount: 'VIP account',
  lockedAccountShort: 'Deposits and transfers for VIP purchases',
  withdrawAccount: 'Withdrawal account',
  withdrawAccountShort: 'Task earnings available for USDT withdrawal',
  deposit: 'Deposit',
  withdraw: 'Withdraw',
  transfer: 'Transfer',
  amount: 'Amount',
  usdtWallet: 'USDT wallet',
  usdtWalletPlaceholder: 'TRC20 / ERC20 wallet address',
  addLocked: 'Deposit to VIP account',
  requestWithdraw: 'Request withdrawal',
  moveToLocked: 'Transfer to VIP account',
  network: 'Network',
  depositAddress: 'Deposit address',
  copyAddress: 'Copy address',
  quickWallet: 'Wallet actions',
  walletNote: 'Deposits go to the VIP account and are used for VIP purchases. Only task earnings can be withdrawn.',
  withdrawalFeeNote: 'Withdrawal fee: 10%. You receive 90% of the requested amount.',
  freeDaysLeft: (days) => `${days} free days left`,
  freeExpired: 'Membership expired',
  returnDays: (days) => `Gross return: ~${days} days`,
  lockedInfo: 'Can buy VIP packages.',
  withdrawInfo: 'Can withdraw USDT or transfer to VIP account.',
  vipPreview: 'VIP levels',
  currentVip: 'Current VIP',
  vipLevel: 'VIP level',
  dailyTasks: 'Daily tasks',
  dailyTask: 'Daily task',
  maxTaskReward: 'Max task reward',
  teamRate: 'Team rate',
  upgradeCost: 'Upgrade cost',
  buyVip: 'Buy VIP',
  active: 'Active',
  notEnoughLocked: 'Need more VIP account balance',
  vipTitle: 'VIP packages',
  vipSubtitle: 'VIP is bought only from the VIP account.',
  tasksTitle: 'Task page',
  tasksSubtitle: 'Complete available tasks and earn into the withdrawal account.',
  filterAll: 'All',
  filterAvailable: 'Available',
  filterCompleted: 'Completed',
  filterLocked: 'Locked',
  emptyTasks: 'No tasks in this filter yet.',
  reward: 'Reward',
  requiredVip: 'Required',
  minutes: 'min',
  open: 'Open',
  done: 'Completed',
  locked: (vip) => vip,
  taskPlan: 'Task checklist',
  completeTask: 'Complete task',
  completeChecklist: 'Check every step first',
  teamTitle: 'Team',
  teamSubtitle: 'Share your invite code and track your direct team.',
  inviteCode: 'Invite code',
  copyCode: 'Copy code',
  teamMembers: 'Members',
  teamVolume: 'Team VIP volume',
  teamEarned: 'Team task earnings',
  noTeam: 'Your team members will appear here.',
  memberSince: 'Member since',
  meTitle: 'Me',
  meSubtitle: 'Profile, wallet actions, and transaction history.',
  accountSettings: 'Account settings',
  saveChanges: 'Save changes',
  logout: 'Sign out',
  accountNote: 'Your profile and ledger are stored on this local server.',
  historyTitle: 'History',
  noHistory: 'History will appear after wallet or task actions.',
  completed: 'Completed',
  streak: 'Day streak',
  totalEarned: 'Total earned',
  totalWithdrawn: 'Total withdrawn',
  close: 'Close',
  help: 'Help',
  helpTitle: 'How does TaskMall work?',
  helpText: 'TaskMall separates money into two accounts: VIP account balance and withdrawable task earnings.',
  faq1q: 'Where do deposits go?',
  faq1a: 'Deposits go to the VIP account automatically and are used for VIP purchases.',
  faq2q: 'Where do task rewards go?',
  faq2a: 'Task rewards go to the withdrawal account, where USDT withdrawals can be requested.',
  faq3q: 'Can earnings buy VIP?',
  faq3a: 'Yes. Transfer from the withdrawal account to the VIP account, then buy VIP.',
  showPassword: 'Show password',
  language: 'Language',
  taskSuccess: (amount) => `Task complete. ${amount} added to withdrawal balance.`,
  profileSaved: 'Profile updated.',
  depositSuccess: 'Deposit added to VIP account.',
  transferSuccess: 'Moved to VIP account.',
  withdrawSuccess: 'Withdrawal request created.',
  vipSuccess: (name) => `${name} activated.`,
  copied: 'Invite code copied.',
  addressCopied: 'Deposit address copied.',
  passwordMismatch: 'Passwords do not match.',
  genericError: 'Something went wrong. Please try again.',
  activityTask: 'Task reward',
  activityDeposit: 'Deposit',
  activityWithdraw: 'Withdrawal request',
  activityTransfer: 'Transfer to VIP account',
  activityVip: 'VIP purchase',
  activityWelcome: 'Account created',
  earned: (amount) => `${amount} USDT`
};

const copy = {
  en,
  ka: {
    tagline: 'დავალებები, VIP დონეები და სუფთა USDT ბალანსები',
    storyTitle: 'TaskMall ყველა ბალანსს სწორ ადგილზე ინახავს.',
    storyText: 'დეპოზიტი შედის ჩაკეტილ VIP ანგარიშზე. task reward შედის გასატან ანგარიშზე.',
    story1: 'ჩაკეტილი VIP ბალანსი შესაძენად',
    story2: 'დავალების თანხა ცალკე ირიცხება',
    story3: 'reward-ის გადატანა VIP ბალანსზე შეგიძლია',
    welcome: 'კეთილი იყოს შენი მობრძანება TaskMall-ში',
    authSubtitle: 'შექმენი ანგარიში ან გააგრძელე იქიდან, სადაც გაჩერდი.',
    signup: 'რეგისტრაცია',
    signin: 'შესვლა',
    fullName: 'სახელი და გვარი',
    fullNamePlaceholder: 'მაგ. ნინო მაისურაძე',
    email: 'ელფოსტა',
    emailPlaceholder: 'name@example.com',
    password: 'პაროლი',
    passwordPlaceholder: 'მინიმუმ 8 სიმბოლო',
    confirmPassword: 'გაიმეორე პაროლი',
    referral: 'მოწვევის კოდი',
    referralPlaceholder: 'არასავალდებულო',
    createAccount: 'ანგარიშის შექმნა',
    signInAction: 'შესვლა',
    navHome: 'Home',
    navTasks: 'Tasks',
    navVip: 'VIP',
    navTeam: 'Team',
    navMe: 'Me',
    greeting: (name) => `გამარჯობა, ${name.split(' ')[0]}`,
    heroTitle: 'მართე VIP ბალანსი და task reward-ები ერთ dashboard-ში.',
    heroText: 'ჩარიცხული თანხა იკეტება VIP შესაძენად. შესრულებული task-ების თანხა რჩება withdrawal ანგარიშზე, სანამ გაიტან ან VIP ბალანსზე გადაიტან.',
    lockedAccount: 'ჩაკეტილი VIP ანგარიში',
    lockedAccountShort: 'დეპოზიტი და transfer VIP შესაძენად',
    withdrawAccount: 'Withdrawal ანგარიში',
    withdrawAccountShort: 'Task reward, რომლის გატანაც შეიძლება',
    deposit: 'Deposit',
    withdraw: 'Withdraw',
    transfer: 'Transfer',
    amount: 'თანხა',
    usdtWallet: 'USDT wallet',
    usdtWalletPlaceholder: 'TRC20 / ERC20 მისამართი',
    addLocked: 'ჩაკეტილზე დამატება',
    requestWithdraw: 'Withdraw მოთხოვნა',
    moveToLocked: 'ჩაკეტილზე გადატანა',
    quickWallet: 'Wallet მოქმედებები',
    walletNote: 'Deposit იკეტება და ვერ გაიტანება. გატანა მხოლოდ task reward-ის ანგარიშიდანაა შესაძლებელი.',
  withdrawalFeeNote: 'Withdrawal fee: 10%. მოთხოვნილი თანხის 90% ირიცხება.',
  freeDaysLeft: (days) => `Free დღე დარჩა: ${days}`,
  freeExpired: 'Free დღეები ამოიწურა',
  returnDays: (days) => `დაბრუნება gross: ~${days} დღე`,
    lockedInfo: 'VIP-ს ყიდულობს. ვერ გაიტან.',
    withdrawInfo: 'შეგიძლია გაიტანო USDT ან გადაიტანო locked-ზე.',
    vipPreview: 'VIP დონეები',
    currentVip: 'მიმდინარე VIP',
    vipLevel: 'VIP დონე',
    dailyTasks: 'დღიური task',
  dailyTask: 'დღიური task',
    maxTaskReward: 'მაქს. reward',
    teamRate: 'Team rate',
    upgradeCost: 'Upgrade ფასი',
    buyVip: 'VIP ყიდვა',
    active: 'აქტიური',
    notEnoughLocked: 'Locked ბალანსი არ კმარა',
    vipTitle: 'VIP პაკეტები',
    vipSubtitle: 'VIP იყიდება მხოლოდ ჩაკეტილი ანგარიშიდან.',
    tasksTitle: 'Tasks გვერდი',
    tasksSubtitle: 'შეასრულე ხელმისაწვდომი task-ები და თანხა withdrawal ანგარიშზე მიიღე.',
    filterAll: 'ყველა',
    filterAvailable: 'ხელმისაწვდომი',
    filterCompleted: 'დასრულებული',
    filterLocked: 'ჩაკეტილი',
    emptyTasks: 'ამ ფილტრში task ჯერ არ არის.',
    reward: 'Reward',
    requiredVip: 'საჭიროა',
    minutes: 'წთ',
    open: 'გახსნა',
    done: 'დასრულებულია',
    locked: (vip) => vip,
    taskPlan: 'Task checklist',
    completeTask: 'Task-ის დასრულება',
    completeChecklist: 'ჯერ მონიშნე ყველა ნაბიჯი',
    teamTitle: 'Team',
    teamSubtitle: 'გააზიარე მოწვევის კოდი და აკონტროლე direct team.',
    inviteCode: 'მოწვევის კოდი',
    copyCode: 'კოდის კოპირება',
    teamMembers: 'წევრები',
    teamVolume: 'Team locked volume',
    teamEarned: 'Team task earnings',
    noTeam: 'Team წევრები აქ გამოჩნდება.',
    memberSince: 'წევრია',
    meTitle: 'Me',
    meSubtitle: 'პროფილი, wallet მოქმედებები და ისტორია.',
    accountSettings: 'ანგარიშის პარამეტრები',
    saveChanges: 'ცვლილებების შენახვა',
    logout: 'გასვლა',
    accountNote: 'პროფილი და ledger ინახება ამ ლოკალურ სერვერზე.',
    historyTitle: 'ისტორია',
    noHistory: 'ისტორია wallet ან task მოქმედების შემდეგ გამოჩნდება.',
    completed: 'დასრულებული',
    streak: 'დღიანი სერია',
    totalEarned: 'სულ მიღებული',
    totalWithdrawn: 'სულ გატანილი',
    close: 'დახურვა',
    help: 'დახმარება',
    helpTitle: 'როგორ მუშაობს TaskMall?',
    helpText: 'TaskMall თანხას ორ ანგარიშად ყოფს: locked VIP ბალანსი და withdrawal task earnings.',
    faq1q: 'Deposit სად ირიცხება?',
    faq1a: 'Deposit შედის locked VIP ანგარიშზე და იქიდან ვერ გაიტანება.',
    faq2q: 'Task reward სად ჯდება?',
    faq2a: 'Task reward ჯდება withdrawal ანგარიშზე, საიდანაც USDT withdraw შეიძლება.',
    faq3q: 'Reward-ით VIP ვიყიდი?',
    faq3a: 'კი. withdrawal-დან locked ანგარიშზე გადაიტან და VIP-ს იქიდან იყიდი.',
    showPassword: 'პაროლის ჩვენება',
    language: 'ენა',
    taskSuccess: (amount) => `Task დასრულდა. ${amount} დაემატა withdrawal ბალანსს.`,
    profileSaved: 'პროფილი განახლდა.',
    depositSuccess: 'Deposit დაემატა locked ბალანსს.',
    transferSuccess: 'თანხა გადავიდა locked ბალანსზე.',
    withdrawSuccess: 'Withdraw მოთხოვნა შეიქმნა.',
    vipSuccess: (name) => `${name} გააქტიურდა.`,
    copied: 'მოწვევის კოდი დაკოპირდა.',
    passwordMismatch: 'პაროლები ერთმანეთს არ ემთხვევა.',
    genericError: 'რაღაც ვერ გამოვიდა. სცადე თავიდან.',
    activityTask: 'Task reward',
    activityDeposit: 'Deposit',
    activityWithdraw: 'Withdraw მოთხოვნა',
    activityTransfer: 'Transfer locked-ზე',
    activityVip: 'VIP შეძენა',
    activityWelcome: 'ანგარიში შეიქმნა',
    earned: (amount) => `${amount} USDT`
  },
  es: {
    navHome: 'Inicio', navTasks: 'Tareas', navVip: 'VIP', navTeam: 'Equipo', navMe: 'Yo',
    deposit: 'Depositar', withdraw: 'Retirar', transfer: 'Transferir', lockedAccount: 'Cuenta VIP bloqueada',
    withdrawAccount: 'Cuenta de retiro', buyVip: 'Comprar VIP', active: 'Activo', language: 'Idioma',
    tasksTitle: 'Tareas', vipTitle: 'Paquetes VIP', teamTitle: 'Equipo', meTitle: 'Yo',
    welcome: 'Bienvenido a TaskMall', signin: 'Entrar', signup: 'Registro'
  },
  fr: {
    navHome: 'Accueil', navTasks: 'Tâches', navVip: 'VIP', navTeam: 'Équipe', navMe: 'Moi',
    deposit: 'Dépôt', withdraw: 'Retrait', transfer: 'Transfert', lockedAccount: 'Compte VIP bloqué',
    withdrawAccount: 'Compte retrait', buyVip: 'Acheter VIP', active: 'Actif', language: 'Langue',
    tasksTitle: 'Tâches', vipTitle: 'Packs VIP', teamTitle: 'Équipe', meTitle: 'Moi',
    welcome: 'Bienvenue sur TaskMall', signin: 'Connexion', signup: 'Inscription'
  },
  de: {
    navHome: 'Home', navTasks: 'Tasks', navVip: 'VIP', navTeam: 'Team', navMe: 'Ich',
    deposit: 'Einzahlen', withdraw: 'Auszahlen', transfer: 'Transfer', lockedAccount: 'Gesperrtes VIP-Konto',
    withdrawAccount: 'Auszahlungskonto', buyVip: 'VIP kaufen', active: 'Aktiv', language: 'Sprache',
    tasksTitle: 'Tasks', vipTitle: 'VIP-Pakete', teamTitle: 'Team', meTitle: 'Ich',
    welcome: 'Willkommen bei TaskMall', signin: 'Anmelden', signup: 'Registrieren'
  },
  ru: {
    navHome: 'Главная', navTasks: 'Задачи', navVip: 'VIP', navTeam: 'Команда', navMe: 'Я',
    deposit: 'Депозит', withdraw: 'Вывод', transfer: 'Перевод', lockedAccount: 'Заблокированный VIP счет',
    withdrawAccount: 'Счет вывода', buyVip: 'Купить VIP', active: 'Активен', language: 'Язык',
    tasksTitle: 'Задачи', vipTitle: 'VIP пакеты', teamTitle: 'Команда', meTitle: 'Я',
    welcome: 'Добро пожаловать в TaskMall', signin: 'Войти', signup: 'Регистрация'
  },
  tr: {
    navHome: 'Ana sayfa', navTasks: 'Görevler', navVip: 'VIP', navTeam: 'Takım', navMe: 'Ben',
    deposit: 'Yatır', withdraw: 'Çek', transfer: 'Transfer', lockedAccount: 'Kilitli VIP hesabı',
    withdrawAccount: 'Çekim hesabı', buyVip: 'VIP al', active: 'Aktif', language: 'Dil',
    tasksTitle: 'Görevler', vipTitle: 'VIP paketleri', teamTitle: 'Takım', meTitle: 'Ben',
    welcome: 'TaskMall’a hoş geldin', signin: 'Giriş', signup: 'Kayıt'
  },
  ar: {
    navHome: 'الرئيسية', navTasks: 'المهام', navVip: 'VIP', navTeam: 'الفريق', navMe: 'أنا',
    deposit: 'إيداع', withdraw: 'سحب', transfer: 'تحويل', lockedAccount: 'حساب VIP مقفل',
    withdrawAccount: 'حساب السحب', buyVip: 'شراء VIP', active: 'نشط', language: 'اللغة',
    tasksTitle: 'المهام', vipTitle: 'باقات VIP', teamTitle: 'الفريق', meTitle: 'أنا',
    welcome: 'مرحباً بك في TaskMall', signin: 'دخول', signup: 'تسجيل'
  },
  hi: {
    navHome: 'होम', navTasks: 'टास्क', navVip: 'VIP', navTeam: 'टीम', navMe: 'मैं',
    deposit: 'जमा', withdraw: 'निकासी', transfer: 'ट्रांसफर', lockedAccount: 'लॉक VIP खाता',
    withdrawAccount: 'निकासी खाता', buyVip: 'VIP खरीदें', active: 'सक्रिय', language: 'भाषा',
    tasksTitle: 'टास्क', vipTitle: 'VIP पैकेज', teamTitle: 'टीम', meTitle: 'मैं',
    welcome: 'TaskMall में आपका स्वागत है', signin: 'साइन इन', signup: 'साइन अप'
  },
  zh: {
    navHome: '首页', navTasks: '任务', navVip: 'VIP', navTeam: '团队', navMe: '我的',
    deposit: '充值', withdraw: '提现', transfer: '转入', lockedAccount: '锁定VIP账户',
    withdrawAccount: '提现账户', buyVip: '购买VIP', active: '已激活', language: '语言',
    tasksTitle: '任务', vipTitle: 'VIP套餐', teamTitle: '团队', meTitle: '我的',
    welcome: '欢迎来到 TaskMall', signin: '登录', signup: '注册'
  }
};

Object.assign(copy.ka, {
  storyText: 'დეპოზიტი ავტომატურად ირიცხება VIP account-ზე. task reward ცალკე ჯდება withdrawal account-ზე.',
  story1: 'VIP account ბალანსი VIP შესაძენად',
  heroText: 'ჩარიცხული თანხა ავტომატურად გამოჩნდება VIP account-ზე. ამ ბალანსით იყიდი VIP პაკეტებს, შემდეგ დაამატებ ახალ დეპოზიტს ან withdrawal account-იდან გადმოიტან task reward-ს.',
  lockedAccount: 'VIP account',
  lockedAccountShort: 'დეპოზიტები და transfer-ები VIP შესაძენად',
  addLocked: 'Deposit VIP account-ზე',
  moveToLocked: 'Transfer VIP account-ზე',
  network: 'ქსელი',
  depositAddress: 'ჩარიცხვის მისამართი',
  copyAddress: 'მისამართის კოპირება',
  walletNote: 'დეპოზიტი შედის VIP account-ზე და გამოიყენება VIP-ის შესაძენად. გატანა შესაძლებელია მხოლოდ task reward-ის withdrawal account-იდან.',
  lockedInfo: 'VIP პაკეტების შესაძენად.',
  withdrawInfo: 'შეგიძლია USDT-ის გატანა ან VIP account-ზე გადატანა.',
  notEnoughLocked: 'VIP account ბალანსი არ კმარა',
  vipSubtitle: 'VIP იყიდება მხოლოდ VIP account-იდან.',
  teamVolume: 'Team VIP volume',
  helpText: 'TaskMall თანხას ორ ანგარიშად ყოფს: VIP account VIP შესაძენად და withdrawal account task reward-ების გასატანად.',
  faq1a: 'Deposit ავტომატურად შედის VIP account-ზე და გამოიყენება VIP პაკეტებისთვის.',
  faq3a: 'კი. withdrawal account-იდან VIP account-ზე გადაიტან და VIP-ს იქიდან იყიდი.',
  depositSuccess: 'Deposit დაემატა VIP account-ს.',
  transferSuccess: 'თანხა გადავიდა VIP account-ზე.',
  addressCopied: 'ჩარიცხვის მისამართი დაკოპირდა.',
  activityTransfer: 'Transfer VIP account-ზე'
});

Object.assign(copy.es, { lockedAccount: 'Cuenta VIP' });
Object.assign(copy.fr, { lockedAccount: 'Compte VIP' });
Object.assign(copy.de, { lockedAccount: 'VIP-Konto' });
Object.assign(copy.ru, { lockedAccount: 'VIP счет' });
Object.assign(copy.tr, { lockedAccount: 'VIP hesabı' });
Object.assign(copy.ar, { lockedAccount: 'حساب VIP' });
Object.assign(copy.hi, { lockedAccount: 'VIP खाता' });
Object.assign(copy.zh, { lockedAccount: 'VIP账户' });

const errors = {
  en: {
    INVALID_NAME: 'Name must be between 2 and 50 characters.',
    INVALID_EMAIL: 'Enter a valid email address.',
    WEAK_PASSWORD: 'Use at least 8 characters with one letter and one number.',
    EMAIL_EXISTS: 'An account with this email already exists.',
    INVALID_CREDENTIALS: 'The email or password is incorrect.',
    TOO_MANY_REQUESTS: 'Too many attempts. Try again in a little while.',
    ALREADY_COMPLETED: 'This task is already complete.',
    AUTH_REQUIRED: 'Your session ended. Please sign in again.',
    INVALID_AMOUNT: 'Enter a valid USDT amount.',
    INVALID_WALLET: 'Enter a valid USDT wallet address.',
    INSUFFICIENT_WITHDRAW_BALANCE: 'Not enough withdrawal balance.',
    INSUFFICIENT_LOCKED_BALANCE: 'Not enough locked VIP balance.',
    VIP_REQUIRED: 'A higher VIP level is required.',
    VIP_ALREADY_ACTIVE: 'This VIP level is already active.',
    DAILY_LIMIT: 'Your daily task limit is reached.',
    VIP_EXPIRED: 'Your membership has expired. Activate a package to continue.',
    INVALID_REFERRAL: 'Invite code was not found.'
  },
  ka: {
    INVALID_NAME: 'სახელი უნდა შეიცავდეს 2-დან 50-მდე სიმბოლოს.',
    INVALID_EMAIL: 'შეიყვანე სწორი ელფოსტა.',
    WEAK_PASSWORD: 'პაროლი უნდა შეიცავდეს მინიმუმ 8 სიმბოლოს, ერთ ასოს და ერთ ციფრს.',
    EMAIL_EXISTS: 'ამ ელფოსტით ანგარიში უკვე არსებობს.',
    INVALID_CREDENTIALS: 'ელფოსტა ან პაროლი არასწორია.',
    TOO_MANY_REQUESTS: 'ძალიან ბევრი მცდელობაა. ცოტა ხანში სცადე.',
    ALREADY_COMPLETED: 'ეს task უკვე დასრულებულია.',
    AUTH_REQUIRED: 'სესია დასრულდა. თავიდან შედი.',
    INVALID_AMOUNT: 'შეიყვანე სწორი USDT თანხა.',
    INVALID_WALLET: 'შეიყვანე სწორი USDT wallet მისამართი.',
    INSUFFICIENT_WITHDRAW_BALANCE: 'Withdrawal ბალანსი არ კმარა.',
    INSUFFICIENT_LOCKED_BALANCE: 'Locked VIP ბალანსი არ კმარა.',
    VIP_REQUIRED: 'უფრო მაღალი VIP დონეა საჭირო.',
    VIP_ALREADY_ACTIVE: 'ეს VIP დონე უკვე აქტიურია.',
    DAILY_LIMIT: 'დღიური task ლიმიტი მიღწეულია.',
    VIP_EXPIRED: 'წევრობის ვადა ამოიწურა. გასაგრძელებლად გაააქტიურე პაკეტი.',
    INVALID_REFERRAL: 'მოწვევის კოდი ვერ მოიძებნა.'
  }
};

errors.en.PAYMENTS_UNAVAILABLE = 'Deposits and withdrawals are temporarily unavailable.';
errors.ka.PAYMENTS_UNAVAILABLE = 'შევსება და გატანა დროებით მიუწვდომელია.';
errors.en.DEPOSITS_UNAVAILABLE = 'Deposits are temporarily unavailable. Please try again later.';
errors.ka.DEPOSITS_UNAVAILABLE = 'შევსება დროებით მიუწვდომელია. სცადეთ მოგვიანებით.';

Object.assign(en, {
  tronOnly: 'Send only USDT on the TRON (TRC20) network. Other assets and networks are not supported.',
  depositAutomatic: 'Your balance updates automatically after blockchain confirmation.',
  depositWaiting: 'Waiting for a confirmed deposit', depositUnavailable: 'Deposits are not available yet.',
  withdrawalUnavailable: 'Withdrawals are not available yet.', explorer: 'View on TRONSCAN',
  depositReceived: 'A confirmed USDT deposit has been credited.', loadingAddress: 'Preparing your deposit address...'
});
en.depositsReady = 'USDT TRC20 deposits are available. Withdrawals are not enabled yet.';
Object.assign(en, { reservedFunds: 'Reserved for withdrawals', confirmWithdrawalPassword: 'Confirm your account password',
  minimumWithdrawal: (amount) => `Minimum withdrawal request: ${amount} USDT.`,
  netToReceive: 'You receive after the 10% fee', requested: 'Awaiting review', approved: 'Approved', submitted: 'Awaiting blockchain confirmation',
  confirmed: 'Confirmed', rejected: 'Rejected', pending: 'Pending', paymentsManual: 'USDT TRC20 deposits and manually reviewed withdrawals are available.' });
Object.assign(copy.ka, { reservedFunds: 'გატანისთვის დაჯავშნილია', confirmWithdrawalPassword: 'დაადასტურე ანგარიშის პაროლი',
  minimumWithdrawal: (amount) => `გატანის მოთხოვნის მინიმუმი: ${amount} USDT.`,
  netToReceive: 'მიიღებ 10%-იანი საკომისიოს შემდეგ', requested: 'განხილვის მოლოდინში', approved: 'დამტკიცებულია',
  submitted: 'ბლოკჩეინზე დადასტურების მოლოდინში', confirmed: 'დადასტურებულია', rejected: 'უარყოფილია', pending: 'მოლოდინში',
  paymentsManual: 'USDT TRC20 შევსება და ხელით განხილული გატანები ხელმისაწვდომია.' });
errors.en.PASSWORD_CONFIRMATION_REQUIRED = 'Confirm your current account password.';
errors.ka.PASSWORD_CONFIRMATION_REQUIRED = 'დაადასტურე ანგარიშის მოქმედი პაროლი.';
errors.en.WITHDRAWAL_BELOW_MINIMUM = 'The minimum withdrawal request is 10 USDT.';
errors.ka.WITHDRAWAL_BELOW_MINIMUM = 'გატანის მოთხოვნის მინიმუმია 10 USDT.';
errors.en.REQUEST_KEY_CONFLICT = 'This request was already used with different details. Close and reopen the withdrawal form.';
errors.ka.REQUEST_KEY_CONFLICT = 'ეს მოთხოვნა სხვა მონაცემებით უკვე გამოყენებულია. დახურე და ხელახლა გახსენი გატანის ფორმა.';
Object.assign(copy.ka, {
  tronOnly: 'გადმორიცხეთ მხოლოდ USDT, TRON (TRC20) ქსელით. სხვა აქტივები და ქსელები მხარდაჭერილი არ არის.',
  depositAutomatic: 'ბალანსი ავტომატურად განახლდება ბლოკჩეინზე დადასტურების შემდეგ.',
  depositWaiting: 'დადასტურებული ჩარიცხვის მოლოდინში', depositUnavailable: 'შევსება ჯერ მიუწვდომელია.',
  withdrawalUnavailable: 'გატანა ჯერ მიუწვდომელია.', explorer: 'ნახვა TRONSCAN-ზე',
  depositReceived: 'დადასტურებული USDT ჩარიცხვა აისახა ბალანსზე.', loadingAddress: 'ჩარიცხვის მისამართი მზადდება...'
});
copy.ka.depositsReady = 'USDT TRC20 შევსება ხელმისაწვდომია. გატანა ჯერ არ არის ჩართული.';
errors.en.STORAGE_UNAVAILABLE = 'Account operations are temporarily unavailable.';
errors.ka.STORAGE_UNAVAILABLE = 'ანგარიშის ოპერაციები დროებით მიუწვდომელია.';
errors.en.INVALID_NETWORK = 'Choose a supported USDT network.';
errors.en.INSUFFICIENT_LOCKED_BALANCE = 'Not enough VIP account balance.';
errors.ka.INVALID_NETWORK = 'აირჩიე მხარდაჭერილი USDT ქსელი.';
errors.ka.INSUFFICIENT_LOCKED_BALANCE = 'VIP account ბალანსი არ კმარა.';

Object.assign(en, {
  workspace: 'Workspace', overview: 'Overview', walletTitle: 'Wallet', company: 'Company', support: 'Support',
  account: 'Account', platform: 'Platform', workspaceStatus: 'TaskMall Workspace', authBrandText: 'One workspace. Every possibility.',
  authBrandSub: 'Tasks, your team, and your accounts. Connected in TaskMall.',
  signupTitle: 'Create your account', loginTitle: 'Welcome back', authSubtitle: 'Your TaskMall workspace is ready when you are.',
  overviewText: 'Your accounts and today\'s work, at a glance.', viewAll: 'View all', availableNow: 'Available now',
  dailyProgress: 'Today\'s progress', earningsWeek: 'Task earnings', lastSevenDays: 'Last 7 days',
  totalBalance: 'Total account balance', membership: 'Your membership', membershipText: 'Your active plan and daily task allowance.',
  explorePlans: 'Explore plans', taskSearch: 'Search tasks', taskSort: 'Sort tasks', sortDefault: 'VIP level', sortReward: 'Highest reward', sortTime: 'Shortest duration',
  noActivity: 'No activity yet', noActivityText: 'Your account activity will appear here.', emptyTeamTitle: 'Build your team',
  emptyTeamText: 'Share your invite code. Members will appear here after they register.',
  companyTitle: 'TaskMall', companySubtitle: 'A connected workspace for tasks, accounts, and teams.',
  companyText: 'TaskMall brings daily work and account management together in one workspace. Your task history, membership, balances, and team remain accessible from a single account.',
  companyPrinciple1: 'Clarity', companyPrinciple1Text: 'Separate account balances and a visible transaction history.',
  companyPrinciple2: 'Connection', companyPrinciple2Text: 'Daily tasks, membership, and your team in one workspace.',
  companyPrinciple3: 'Control', companyPrinciple3Text: 'Manage your profile, review your activity, and choose your next action.',
  platformStatus: 'Platform status', paymentStatusDetail: 'Payments are temporarily unavailable. Deposits and withdrawals will resume when processing is available.',
  accountFlow: 'Account overview', dailyAllowance: 'Daily allowance', taskAvailable: 'tasks available', todayDone: 'completed today',
  download: 'Download CSV', transactionType: 'Transaction', transactionDate: 'Date', transactionAmount: 'Amount',
  helpSubtitle: 'Answers about your accounts, tasks, and membership.', supportAccount: 'Account support',
  supportAccountText: 'Manage your profile and review your account activity.', menu: 'Menu', networkLabel: 'USDT accounts',
  displayName: 'Display name', tasksTitle: 'Tasks', navMe: 'Account', navHome: 'Overview',
  signupNote: 'Email and password are enough to get started.',
  faq4q: 'When will a deposit appear in my balance?', faq4a: 'A deposit must be confirmed by the payment service before it can be credited. Check the Wallet page for payment availability.'
});

Object.assign(copy.ka, {
  workspace: 'სამუშაო სივრცე', overview: 'მიმოხილვა', walletTitle: 'საფულე', company: 'კომპანია', support: 'დახმარება',
  account: 'ანგარიში', platform: 'პლატფორმა', workspaceStatus: 'TaskMall სივრცე',
  authBrandText: 'ერთი სივრცე. ახალი შესაძლებლობები.', authBrandSub: 'დავალებები, გუნდი და ანგარიშები. ყველაფერი TaskMall-ში.',
  signupTitle: 'შექმენი შენი ანგარიში', loginTitle: 'კეთილი იყოს შენი დაბრუნება', authSubtitle: 'შენი TaskMall-ის სამუშაო სივრცე მზად არის.',
  navHome: 'მიმოხილვა', navTasks: 'დავალებები', navVip: 'VIP', navTeam: 'გუნდი', navMe: 'ანგარიში',
  overviewText: 'შენი ანგარიშები და დღევანდელი საქმეები ერთ სივრცეში.', viewAll: 'ყველას ნახვა', availableNow: 'ხელმისაწვდომია',
  dailyProgress: 'დღევანდელი პროგრესი', earningsWeek: 'დავალებების შემოსავალი', lastSevenDays: 'ბოლო 7 დღე',
  totalBalance: 'ანგარიშების ჯამური ბალანსი', membership: 'შენი წევრობა', membershipText: 'აქტიური პაკეტი და დღიური დავალებების რაოდენობა.',
  explorePlans: 'პაკეტების ნახვა', taskSearch: 'დავალებების ძიება', taskSort: 'დავალებების დალაგება',
  sortDefault: 'VIP დონის მიხედვით', sortReward: 'მაღალი ჯილდო', sortTime: 'მოკლე ხანგრძლივობა',
  noActivity: 'აქტივობა ჯერ არ არის', noActivityText: 'შენი ანგარიშის აქტივობა აქ გამოჩნდება.',
  emptyTeamTitle: 'შექმენი შენი გუნდი', emptyTeamText: 'გააზიარე მოწვევის კოდი. წევრები რეგისტრაციის შემდეგ აქ გამოჩნდებიან.',
  companyTitle: 'TaskMall', companySubtitle: 'ერთიანი სამუშაო სივრცე დავალებებისთვის, ანგარიშებისა და გუნდებისთვის.',
  companyText: 'TaskMall აერთიანებს ყოველდღიურ დავალებებს და ანგარიშების მართვას. დავალებების ისტორია, წევრობა, ბალანსები და გუნდი ერთი ანგარიშიდან არის ხელმისაწვდომი.',
  companyPrinciple1: 'გამჭვირვალობა', companyPrinciple1Text: 'გამიჯნული ბალანსები და ტრანზაქციების სრული ისტორია.',
  companyPrinciple2: 'კავშირი', companyPrinciple2Text: 'ყოველდღიური დავალებები, წევრობა და გუნდი ერთ სივრცეში.',
  companyPrinciple3: 'კონტროლი', companyPrinciple3Text: 'მართე პროფილი, შეამოწმე აქტივობა და აირჩიე შემდეგი ნაბიჯი.',
  platformStatus: 'პლატფორმის სტატუსი', paymentStatusDetail: 'გადახდები დროებით მიუწვდომელია. შევსება და გატანა ხელმისაწვდომი გახდება გადახდების ჩართვის შემდეგ.',
  accountFlow: 'ანგარიშების მიმოხილვა', dailyAllowance: 'დღიური ლიმიტი', taskAvailable: 'ხელმისაწვდომი დავალება', todayDone: 'დღეს შესრულებული',
  download: 'CSV-ის ჩამოტვირთვა', transactionType: 'ტრანზაქცია', transactionDate: 'თარიღი', transactionAmount: 'თანხა',
  helpSubtitle: 'პასუხები ანგარიშების, დავალებებისა და წევრობის შესახებ.', supportAccount: 'ანგარიშის მართვა',
  supportAccountText: 'განაახლე პროფილი და შეამოწმე ანგარიშის აქტივობა.', menu: 'მენიუ', networkLabel: 'USDT ანგარიშები',
  displayName: 'პროფილის სახელი', signupNote: 'დასაწყებად ელფოსტა და პაროლი საკმარისია.',
  lockedAccount: 'VIP ბალანსი', withdrawAccount: 'გასატანი ბალანსი', deposit: 'შევსება', recharge: 'შევსება',
  withdraw: 'გატანა', transfer: 'გადატანა', lockedInfo: 'VIP პაკეტების შესაძენად', withdrawInfo: 'დავალებების ჯილდოები',
  quickWallet: 'ბალანსების მართვა', walletNote: 'შევსებული თანხა აისახება VIP ბალანსზე. დავალებების ჯილდოები ირიცხება გასატან ბალანსზე.',
  addLocked: 'VIP ბალანსის შევსება', requestWithdraw: 'გატანის მოთხოვნა', moveToLocked: 'VIP ბალანსზე გადატანა',
  currentVip: 'აქტიური პაკეტი', completed: 'შესრულებული', streak: 'დღეების სერია', totalEarned: 'ჯამური შემოსავალი',
  tasksTitle: 'დავალებები', tasksSubtitle: 'ხელმისაწვდომი დავალებები და შესრულების ისტორია.', emptyTasks: 'ამ არჩევანში დავალებები არ მოიძებნა.',
  reward: 'ჯილდო', requiredVip: 'პაკეტი', taskPlan: 'დავალების ნაბიჯები', completeTask: 'დავალების დასრულება', completeChecklist: 'მონიშნე ყველა ნაბიჯი',
  dailyTask: 'დღიური დავალება', dailyTasks: 'დღიური დავალება', maxTaskReward: 'დავალების ჯილდო', teamRate: 'გუნდის განაკვეთი',
  vipTitle: 'VIP წევრობა', vipSubtitle: 'შეადარე პაკეტები და აირჩიე შენთვის შესაფერისი დონე.',
  upgradeCost: 'განახლების ღირებულება', buyVip: 'პაკეტის გააქტიურება', notEnoughLocked: 'ბალანსი არასაკმარისია',
  teamTitle: 'შენი გუნდი', teamSubtitle: 'მოწვევები, წევრები და გუნდის შედეგები.', teamVolume: 'გუნდის VIP მოცულობა', teamEarned: 'გუნდის შემოსავალი',
  meTitle: 'შენი ანგარიში', meSubtitle: 'პროფილის მონაცემები და პარამეტრები.', accountSettings: 'პროფილის პარამეტრები',
  activityTask: 'დავალების ჯილდო', activityDeposit: 'ბალანსის შევსება', activityWithdraw: 'გატანის მოთხოვნა',
  activityTransfer: 'VIP ბალანსზე გადატანა', activityVip: 'პაკეტის შეძენა', activityWelcome: 'ანგარიშის შექმნა',
  helpTitle: 'დახმარების ცენტრი', helpText: 'იპოვე პასუხები TaskMall-ის ანგარიშებსა და ოპერაციებზე.',
  faq1q: 'სად ირიცხება შევსებული თანხა?', faq1a: 'შევსებული თანხა ავტომატურად ირიცხება VIP ბალანსზე, საიდანაც შეგიძლია პაკეტის შეძენა.',
  faq2q: 'სად ირიცხება დავალების ჯილდო?', faq2a: 'დავალების ჯილდო ირიცხება გასატან ბალანსზე. იქიდან შეგიძლია გატანის მოთხოვნა ან VIP ბალანსზე გადატანა.',
  faq3q: 'შემიძლია ჯილდოთი VIP პაკეტის შეძენა?', faq3a: 'დიახ. გადაიტანე ჯილდო VIP ბალანსზე და შემდეგ გაააქტიურე სასურველი პაკეტი.',
  faq4q: 'როდის აისახება შევსება ბალანსზე?', faq4a: 'თანხა ბალანსზე გადახდის სერვისის დადასტურების შემდეგ უნდა აისახოს. გადახდების ხელმისაწვდომობა საფულის გვერდზე შეამოწმე.',
  freeDaysLeft: (days) => `დარჩენილია ${days} დღე`, freeExpired: 'ვადა ამოიწურა', returnDays: (days) => `მთლიანი უკუგება: ~${days} დღე`,
  usdtWallet: 'USDT საფულის მისამართი', usdtWalletPlaceholder: 'საფულის მისამართი',
  depositAddress: 'შევსების მისამართი', network: 'ქსელი', copyAddress: 'მისამართის კოპირება',
  taskSuccess: (amount) => `დავალება დასრულებულია. ${amount} დაემატა გასატან ბალანსს.`,
  depositSuccess: 'თანხა დაემატა VIP ბალანსს.', transferSuccess: 'თანხა გადაიტანე VIP ბალანსზე.',
  withdrawSuccess: 'გატანის მოთხოვნა შეიქმნა.', previous: 'წინა', next: 'შემდეგი', records: 'ჩანაწერი',
  membershipTerm: 'წევრობის ვადა', days: 'დღე', expiresOn: 'ვადა იწურება', renewVip: 'წევრობის განახლება', paymentsReady: 'გადახდები ხელმისაწვდომია', dailyLimitReached: 'დღიური ლიმიტი მიღწეულია',
  hidePassword: 'პაროლის დამალვა', withdrawalFeeNote: 'გატანის საკომისიო: 10%. მიიღებ მოთხოვნილი თანხის 90%-ს.'
});

Object.assign(en, { membershipTerm: 'Membership term', days: 'days', expiresOn: 'Expires on', renewVip: 'Renew membership', paymentsReady: 'Payment service available', dailyLimitReached: 'Daily limit reached', previous: 'Previous', next: 'Next', records: 'records', hidePassword: 'Hide password' });

function t(key, ...args) {
  const value = copy[state.lang]?.[key] ?? en[key] ?? key;
  return typeof value === 'function' ? value(...args) : value;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function icon(name, className = '') {
  const names = {
    logo: 'ShoppingBag', check: 'Check', mail: 'Mail', user: 'UserRound', users: 'UsersRound',
    lock: 'LockKeyhole', eye: 'Eye', eyeOff: 'EyeOff', arrow: 'ArrowRight', home: 'LayoutDashboard',
    tasks: 'ListChecks', profile: 'UserRound', help: 'CircleHelp', spark: 'Sparkles', star: 'Star',
    flame: 'Flame', trophy: 'Trophy', crown: 'Crown', clock: 'Clock3', list: 'List',
    scan: 'ScanLine', wallet: 'Wallet', chart: 'ChartNoAxesCombined', calendar: 'CalendarDays',
    deposit: 'ArrowDownToLine', withdraw: 'ArrowUpFromLine', transfer: 'ArrowLeftRight',
    briefcase: 'Building2', gift: 'Gift', copy: 'Copy', close: 'X', logout: 'LogOut',
    save: 'Save', info: 'Info', search: 'Search', menu: 'Menu', download: 'Download',
    chevron: 'ChevronRight', globe: 'Globe2', shield: 'ShieldCheck', settings: 'Settings2'
  };
  return lucide.createElement(lucide.icons[names[name] || 'Sparkles'], {
    class: `icon ${className}`, 'aria-hidden': 'true', 'stroke-width': 1.75
  }).outerHTML;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || 'GET',
    headers: options.body || (options.method && options.method !== 'GET') ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: 'same-origin'
  });
  let data = {};
  try { data = await response.json(); } catch { /* response without JSON */ }
  if (!response.ok) {
    const error = new Error(data.error || 'REQUEST_FAILED');
    error.code = data.error;
    error.status = response.status;
    throw error;
  }
  return data;
}

function friendlyError(error) {
  return errors[state.lang]?.[error.code] || errors.en[error.code] || t('genericError');
}

function showToast(message, type = 'success') {
  const element = document.createElement('div');
  element.className = `toast ${type}`;
  element.innerHTML = `<span class="toast-icon">${icon(type === 'success' ? 'check' : 'info')}</span><span>${escapeHtml(message)}</span>`;
  toastRegion.append(element);
  setTimeout(() => element.remove(), 3600);
}

function brand() {
  return '<img class="brand-mark" src="/favicon.svg?v=studio-2" width="36" height="36" alt="" /><span class="brand-wordmark">TaskMall<span class="brand-dot">.</span></span>';
}

function setDocumentLanguage() {
  document.documentElement.lang = state.lang;
  document.documentElement.dir = state.lang === 'ar' ? 'rtl' : 'ltr';
}

function languageSelect(className = '') {
  return `<select class="language-select ${className}" data-language-select aria-label="${escapeHtml(t('language'))}">
    ${languages.map(([code, label]) => `<option value="${code}" ${state.lang === code ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}
  </select>`;
}

function paymentNetwork(id = 'trc20') {
  return paymentNetworks.find((network) => network.id === id) || paymentNetworks[0] || { address: '' };
}

function networkOptions(selected = 'trc20') {
  return paymentNetworks.map((network) => `<option value="${escapeHtml(network.id)}" ${network.id === selected ? 'selected' : ''}>${escapeHtml(network.label)}</option>`).join('');
}

function renderVisualHeader(title, subtitle) {
  return `<header class="page-heading"><div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle)}</p></div></header>`;
}

function renderLoading() {
  app.innerHTML = `<main class="loading-screen"><div class="loading-mark" aria-label="Loading">${icon('logo', 'icon-lg')}</div></main>`;
}

function renderAuth() {
  earningsChart?.destroy();
  const signup = state.authMode === 'signup';
  app.innerHTML = `
    <main class="auth-page">
      <section class="auth-story">
        <a class="brand" href="#" data-action="auth-home">${brand()}</a>
        <div class="story-copy"><span class="eyebrow">TASKMALL WORKSPACE</span><h1>TaskMall<span>.</span></h1><h2>${escapeHtml(t('authBrandText'))}</h2><p>${escapeHtml(t('authBrandSub'))}</p></div>
        <div class="workspace-preview"><img src="/assets/taskmall-headquarters.png?v=studio-3" alt="TaskMall headquarters" width="1792" height="1024" /><span class="preview-label">${icon('building')} TaskMall Headquarters <span>Brand concept</span></span></div>
        <div class="story-footer"><span>TaskMall</span><span>${escapeHtml(t('workspace'))} / 2026</span></div>
      </section>
      <section class="auth-panel">
        <header class="auth-topline"><a class="brand auth-mobile-brand" href="#" data-action="auth-home">${brand()}</a><nav><button class="text-button" type="button" data-action="public-view" data-view="company">${escapeHtml(t('company'))}</button><button class="text-button" type="button" data-action="public-view" data-view="support">${escapeHtml(t('support'))}</button></nav>${languageSelect()}<button class="icon-button auth-company-link" type="button" data-action="public-view" data-view="company" aria-label="${escapeHtml(t('company'))}" title="${escapeHtml(t('company'))}">${icon('briefcase')}</button></header>
        <div class="auth-content">
          <span class="eyebrow">${escapeHtml(t('workspace'))}</span>
          <div class="auth-heading"><h2>${escapeHtml(t(signup ? 'signupTitle' : 'loginTitle'))}</h2><p>${escapeHtml(t('authSubtitle'))}</p></div>
          <div class="auth-tabs" role="tablist" aria-label="${escapeHtml(t('account'))}">
            <button class="auth-tab ${signup ? 'active' : ''}" type="button" role="tab" aria-selected="${signup}" data-action="auth-mode" data-mode="signup">${escapeHtml(t('signup'))}</button>
            <button class="auth-tab ${!signup ? 'active' : ''}" type="button" role="tab" aria-selected="${!signup}" data-action="auth-mode" data-mode="login">${escapeHtml(t('signin'))}</button>
          </div>
          <form class="auth-form" id="auth-form">
            <div class="field"><label for="auth-email">${escapeHtml(t('email'))}</label><div class="field-control">${icon('mail')}<input id="auth-email" name="email" type="email" autocomplete="email" maxlength="120" placeholder="${escapeHtml(t('emailPlaceholder'))}" required /></div></div>
            <div class="field"><label for="auth-password">${escapeHtml(t('password'))}</label><div class="field-control">${icon('lock')}<input id="auth-password" name="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" minlength="8" maxlength="128" placeholder="${escapeHtml(t('passwordPlaceholder'))}" required /><button class="password-toggle" type="button" data-action="toggle-password" data-target="auth-password" aria-label="${escapeHtml(t('showPassword'))}" title="${escapeHtml(t('showPassword'))}">${icon('eye')}</button></div></div>
            ${signup ? `
              <div class="field"><label for="auth-confirm">${escapeHtml(t('confirmPassword'))}</label><div class="field-control">${icon('lock')}<input id="auth-confirm" name="confirm" type="password" autocomplete="new-password" minlength="8" maxlength="128" placeholder="${escapeHtml(t('passwordPlaceholder'))}" required /><button class="password-toggle" type="button" data-action="toggle-password" data-target="auth-confirm" aria-label="${escapeHtml(t('showPassword'))}" title="${escapeHtml(t('showPassword'))}">${icon('eye')}</button></div></div>
              <div class="field"><label for="auth-referral">${escapeHtml(t('referral'))} <span class="optional">${escapeHtml(t('referralPlaceholder'))}</span></label><div class="field-control">${icon('gift')}<input id="auth-referral" name="referral" type="text" maxlength="24" placeholder="TM..." /></div></div>
            ` : ''}
            <p class="form-message" id="auth-message" role="alert"></p>
            <button class="primary-button auth-submit" type="submit">${escapeHtml(t(signup ? 'createAccount' : 'signInAction'))}${icon('arrow')}</button>
          </form>
        </div>
        <footer class="auth-footer"><span>TaskMall &copy; 2026</span><span>${escapeHtml(t('workspaceStatus'))}</span></footer>
      </section>
    </main>`;
  setDocumentLanguage();
}

function navItem(view, label, iconName, mobile = false) {
  return `<button class="${mobile ? 'bottom-nav-button' : 'nav-button'} ${state.view === view ? 'active' : ''}" type="button" data-action="view" data-view="${view}" ${state.view === view ? 'aria-current="page"' : ''}>${icon(iconName)}<span>${escapeHtml(label)}</span>${!mobile && view === 'tasks' ? `<span class="nav-count">${state.tasks.filter(task => !task.locked && !task.completed).length}</span>` : ''}</button>`;
}

function localize(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value[state.lang] || value.en || value.ka || '';
}

function locale() {
  const map = { ka: 'ka-GE', en: 'en-US', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', ru: 'ru-RU', tr: 'tr-TR', ar: 'ar', hi: 'hi-IN', zh: 'zh-CN' };
  return map[state.lang] || 'en-US';
}

function formatUsdt(amount) {
  return `${new Intl.NumberFormat(locale(), { minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(Number(amount) || 0)} USDT`;
}

function formatDate(value, long = false) {
  try {
    if (state.lang === 'ka') {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return '';
      const months = ['იანვარი', 'თებერვალი', 'მარტი', 'აპრილი', 'მაისი', 'ივნისი', 'ივლისი', 'აგვისტო', 'სექტემბერი', 'ოქტომბერი', 'ნოემბერი', 'დეკემბერი'];
      const month = months[date.getMonth()];
      if (long) return `${date.getDate()} ${month}, ${date.getFullYear()}`;
      return `${date.getDate()} ${month.slice(0, 3)}, ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    }
    return new Intl.DateTimeFormat(locale(), long ? { year: 'numeric', month: 'long', day: 'numeric' } : { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
  } catch { return ''; }
}

function displayNameFromEmail(email) {
  const localPart = String(email || '').split('@')[0] || 'TaskMall user';
  const name = localPart.replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 50);
  return name.length >= 2 ? name : 'TaskMall user';
}

function currentVip() {
  return state.vips.find((plan) => plan.current) || { name: state.user?.vipName || 'Free VIP', level: state.user?.vipLevel || 0, dailyTasks: state.user?.vipDailyTasks || 1, maxReward: 0 };
}

function renderBalanceCards() {
  const cards = [
    ['lock', 'locked', t('lockedAccount'), state.user.lockedBalance, t('lockedInfo')],
    ['wallet', 'withdrawable', t('withdrawAccount'), state.user.withdrawBalance, t('withdrawInfo')]
  ];
  return `<section class="balance-grid">${cards.map(([iconName, tone, label, value, sub]) => `
    <article class="balance-card ${tone}">
      <span class="stat-icon">${icon(iconName)}</span>
      <div><span class="balance-label">${escapeHtml(label)}</span><strong>${escapeHtml(formatUsdt(value))}</strong><small>${escapeHtml(sub)}</small></div>
    </article>`).join('')}</section>`;
}

function renderWalletPanel(compact = false) {
  const actions = [
    ['deposit', 'deposit', t('deposit'), t('addLocked'), t('lockedAccount'), 'primary'],
    ['withdraw', 'withdraw', t('withdraw'), t('requestWithdraw'), t('withdrawAccount'), 'green'],
    ['transfer', 'transfer', t('transfer'), t('moveToLocked'), `${t('withdrawAccount')} → ${t('lockedAccount')}`, 'purple']
  ];
  return `
    <section class="wallet-panel">
      <div class="section-heading"><div><h2>${escapeHtml(t('quickWallet'))}</h2><p>${escapeHtml(t('walletNote'))}</p></div></div>
      ${renderBalanceCards()}
      <div class="wallet-actions ${compact ? 'compact' : ''}">
        ${actions.map(([type, iconName, title, actionText, description, tone]) => `
          <button class="wallet-action-card ${tone}" type="button" data-action="open-wallet" data-wallet-type="${type}">
            <span class="stat-icon">${icon(iconName)}</span>
            <span class="wallet-action-label">${escapeHtml(title)}</span>
            <strong>${escapeHtml(actionText)}</strong>
            <small>${escapeHtml(description)}</small>
          </button>`).join('')}
      </div>
    </section>`;
}

function renderWalletDialog() {
  const type = state.walletModal;
  if (!type) return '';
  if (state.paymentMode === 'tron-watch-only' && type !== 'transfer' && (type === 'deposit' || !state.withdrawalsAvailable)) {
    const wallet = state.depositWallet;
    const available = type === 'deposit' && state.paymentsAvailable && wallet;
    return `<div class="dialog-backdrop" data-action="backdrop-close" role="presentation"><section class="dialog wallet-dialog" role="dialog" aria-modal="true" aria-labelledby="wallet-dialog-title"><div class="dialog-head"><span class="dialog-task-icon">${icon(type)}</span><button class="dialog-close" type="button" data-action="close-dialog" aria-label="${escapeHtml(t('close'))}">${icon('close')}</button></div><div class="dialog-body"><span class="dialog-kicker">USDT / TRC20</span><h2 id="wallet-dialog-title">${escapeHtml(t(type))}</h2>${available ? `<div class="native-deposit"><img class="deposit-qr" src="${escapeHtml(wallet.qr)}" width="200" height="200" alt="${escapeHtml(t('depositAddress'))}"><label class="deposit-address-label">${escapeHtml(t('depositAddress'))}</label><div class="native-address-row"><code>${escapeHtml(wallet.address.slice(0, 17))}<wbr>${escapeHtml(wallet.address.slice(17))}</code><button type="button" class="icon-button" data-action="copy-native-deposit" title="${escapeHtml(t('copyAddress'))}" aria-label="${escapeHtml(t('copyAddress'))}">${icon('copy')}</button></div><div class="deposit-warning">${icon('info')}<span>${escapeHtml(t('tronOnly'))}</span></div><p>${escapeHtml(t('depositAutomatic'))}</p><div class="deposit-status">${icon('clock')}<span>${escapeHtml(t('depositWaiting'))}</span></div><a class="text-button" href="${escapeHtml(wallet.explorer)}" target="_blank" rel="noopener noreferrer">${escapeHtml(t('explorer'))}${icon('arrow')}</a></div>` : `<p class="dialog-description">${escapeHtml(t(type === 'withdraw' ? 'withdrawalUnavailable' : 'depositUnavailable'))}</p>`}</div></section></div>`;
  }
  if (type !== 'transfer' && !state.paymentsAvailable) {
    return `<div class="dialog-backdrop" data-action="backdrop-close" role="presentation"><section class="dialog wallet-dialog" role="dialog" aria-modal="true" aria-labelledby="wallet-dialog-title"><div class="dialog-head"><span class="dialog-task-icon">${icon('wallet', 'icon-lg')}</span><button class="dialog-close" type="button" data-action="close-dialog" aria-label="${escapeHtml(t('close'))}">${icon('close')}</button></div><div class="dialog-body"><h2 id="wallet-dialog-title">${escapeHtml(t(type))}</h2><p class="dialog-description">${escapeHtml(t('paymentStatusDetail'))}</p></div></section></div>`;
  }
  const defaultNetwork = paymentNetwork();
  const config = {
    deposit: {
      icon: 'deposit',
      title: t('deposit'),
      description: t('walletNote'),
      submit: t('addLocked'),
      button: 'primary-button',
      fields: `
        <label><span>${escapeHtml(t('network'))}</span><select name="network" data-deposit-network>${networkOptions()}</select></label>
        <label><span>${escapeHtml(t('depositAddress'))}</span><div class="address-row"><input data-deposit-address type="text" value="${escapeHtml(defaultNetwork.address)}" readonly /><button class="secondary-button copy-address-button" type="button" data-action="copy-deposit-address">${icon('copy')} ${escapeHtml(t('copyAddress'))}</button></div></label>
        <label><span>${escapeHtml(t('amount'))}</span><input name="amount" type="number" min="5" step="0.01" placeholder="25.00" required /></label>`
    },
    withdraw: {
      icon: 'withdraw',
      title: t('withdraw'),
      description: state.paymentMode === 'tron-watch-only' ? t('withdrawalFeeNote') : `${t('withdrawInfo')} ${t('withdrawalFeeNote')}`,
      submit: t('requestWithdraw'),
      button: 'secondary-button',
      fields: `
        <label><span>${escapeHtml(t('network'))}</span><select name="network">${networkOptions()}</select></label>
        <label><span>${escapeHtml(t('amount'))}</span><input name="amount" type="number" min="${state.minimumWithdrawalAmount}" max="100000" step="${state.paymentMode === 'tron-watch-only' ? '0.000001' : '0.01'}" placeholder="10.00" aria-describedby="withdrawal-minimum" required /><small class="form-hint" id="withdrawal-minimum">${escapeHtml(t('minimumWithdrawal', state.minimumWithdrawalAmount))}</small></label>
        <label><span>${escapeHtml(t('usdtWallet'))}</span><input name="wallet" type="text" minlength="${state.paymentMode === 'tron-watch-only' ? 34 : 12}" maxlength="${state.paymentMode === 'tron-watch-only' ? 34 : 120}" placeholder="${escapeHtml(state.paymentMode === 'tron-watch-only' ? 'TRON (TRC20) address' : t('usdtWalletPlaceholder'))}" required /></label>
        ${state.paymentMode === 'tron-watch-only' ? `<label><span>${escapeHtml(t('confirmWithdrawalPassword'))}</span><input name="password" type="password" autocomplete="current-password" maxlength="128" required /></label><div class="withdrawal-preview"><span>${escapeHtml(t('netToReceive'))}</span><output data-withdraw-net>${escapeHtml(formatUsdt(0))}</output></div>` : ''}
        ${state.paymentMode === 'tron-watch-only' ? '' : `<p class="form-hint">${escapeHtml(t('withdrawalFeeNote'))}</p>`}`
    },
    transfer: {
      icon: 'transfer',
      title: t('transfer'),
      description: `${t('withdrawAccount')} → ${t('lockedAccount')}`,
      submit: t('moveToLocked'),
      button: 'secondary-button',
      fields: `
        <label><span>${escapeHtml(t('amount'))}</span><input name="amount" type="number" min="1" step="0.01" placeholder="5.00" required /></label>
        <p class="form-hint">${escapeHtml(t('withdrawInfo'))}</p>`
    }
  }[type];
  if (!config) return '';
  return `
    <div class="dialog-backdrop" data-action="backdrop-close" role="presentation">
      <section class="dialog wallet-dialog" role="dialog" aria-modal="true" aria-labelledby="wallet-dialog-title">
        <div class="dialog-head"><span class="dialog-task-icon">${icon(config.icon, 'icon-lg')}</span><button class="dialog-close" type="button" data-action="close-dialog" aria-label="${escapeHtml(t('close'))}">${icon('close')}</button></div>
        <div class="dialog-body">
          ${type === 'withdraw' ? '' : '<span class="dialog-kicker">TaskMall Wallet</span>'}
          <h2 id="wallet-dialog-title">${escapeHtml(config.title)}</h2>
          <p class="dialog-description">${escapeHtml(config.description)}</p>
          <form class="wallet-form modal-wallet-form" data-wallet-form="${escapeHtml(type)}">
            ${config.fields}
            <button class="${config.button} dialog-action" type="submit">${escapeHtml(config.submit)}</button>
          </form>
        </div>
      </section>
    </div>`;
}

function renderMetrics() {
  const items = [
    ['wallet', 'primary', t('totalBalance'), formatUsdt(state.user.lockedBalance + state.user.withdrawBalance + (state.user.reservedBalance || 0)), t('networkLabel')],
    ['withdraw', 'blue', t('withdrawAccount'), formatUsdt(state.user.withdrawBalance), t('withdrawInfo')],
    ['chart', 'amber', t('totalEarned'), formatUsdt(state.user.earnedTotal), t('activityTask')],
    ['tasks', 'neutral', t('dailyProgress'), `${state.tasks.filter(task => task.completed && task.requiredVip === currentVip().level).length} / ${currentVip().dailyTasks}`, t('todayDone')]
  ];
  return `<section class="metrics-grid">${items.map(([symbol, tone, label, value, sub]) => `<article class="metric-card ${tone}"><div class="metric-top"><span>${escapeHtml(label)}</span>${icon(symbol)}</div><strong>${escapeHtml(value)}</strong><small>${escapeHtml(sub)}</small></article>`).join('')}</section>`;
}

function renderTaskRow(task) {
  const unavailable = task.completed || task.locked;
  return `<article class="task-row"><span class="task-row-icon">${renderTaskPhoto(task, 'task-thumbnail')}</span><div class="task-row-copy"><strong>${escapeHtml(localize(task.title))}</strong><span>${escapeHtml(task.requiredVipName)} <span class="separator">/</span> ${task.minutes} ${escapeHtml(t('minutes'))}</span></div><strong class="task-row-reward">${escapeHtml(formatUsdt(task.reward))}</strong><button class="icon-button task-row-action" type="button" data-action="open-task" data-task-id="${task.id}" aria-label="${escapeHtml(localize(task.title))}" title="${escapeHtml(task.completed ? t('done') : task.locked ? task.requiredVipName : t('open'))}" ${unavailable ? 'disabled' : ''}>${icon(task.completed ? 'check' : task.locked ? 'lock' : 'arrow')}</button></article>`;
}

function renderMembership() {
  const vip = currentVip();
  return `<section class="membership-panel"><div class="section-heading"><h2>${escapeHtml(t('membership'))}</h2>${icon('crown')}</div><div class="membership-main"><span class="membership-emblem">${icon('crown')}</span><div><strong>${escapeHtml(vip.name)}</strong><span class="status-pill">${escapeHtml(t(state.user.vipActive ? 'active' : 'freeExpired'))}</span></div></div><div class="membership-details"><div><span>${escapeHtml(t('expiresOn'))}</span><strong>${escapeHtml(formatDate(state.user.vipExpiresAt, true))}</strong></div><div><span>${escapeHtml(t('dailyAllowance'))}</span><strong>${vip.dailyTasks}</strong></div><div><span>${escapeHtml(t('maxTaskReward'))}</span><strong>${escapeHtml(formatUsdt(vip.maxReward))}</strong></div></div><button class="secondary-button" type="button" data-action="view" data-view="vip">${escapeHtml(t('explorePlans'))}${icon('arrow')}</button></section>`;
}

function weekEarnings() {
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - 6 + index);
    return { date, amount: 0 };
  });
  for (const activity of state.activities) {
    if (activity.type !== 'task') continue;
    const date = new Date(activity.at);
    date.setHours(0, 0, 0, 0);
    const bucket = days.find(day => day.date.getTime() === date.getTime());
    if (bucket) bucket.amount += Number(activity.amount) || 0;
  }
  return days;
}

function renderEarnings() {
  const total = weekEarnings().reduce((sum, day) => sum + day.amount, 0);
  return `<section class="earnings-panel"><div class="section-heading"><div><h2>${escapeHtml(t('earningsWeek'))}</h2><p>${escapeHtml(t('lastSevenDays'))}</p></div><strong class="chart-total">${escapeHtml(formatUsdt(total))}</strong></div><div class="chart-container"><canvas id="earnings-chart" role="img" aria-label="${escapeHtml(t('earningsWeek'))}: ${escapeHtml(formatUsdt(total))}"></canvas></div></section>`;
}

function renderTaskPhoto(task, className = 'task-photo') {
  return `<img class="${className}" src="${escapeHtml(task.image)}" alt="${escapeHtml(localize(task.product))}" width="900" height="600" decoding="async" />`;
}

function renderTaskCard(task) {
  const statusClass = task.completed ? 'completed' : task.locked ? 'locked' : '';
  const actionText = task.completed ? t('done') : task.lockedReason === 'VIP_EXPIRED' ? t('freeExpired') : task.lockedReason === 'DAILY_LIMIT' ? t('dailyLimitReached') : task.locked ? t('locked', task.requiredVipName) : t('open');
  const actionIcon = task.completed ? 'check' : task.locked ? 'lock' : 'arrow';
  return `
    <article class="task-card ${statusClass}">
      <div class="task-media">${renderTaskPhoto(task)}</div>
      <div class="task-top">
        <span class="task-level">${icon('crown')}${escapeHtml(task.requiredVipName)}</span>
        <span class="task-points">${icon('wallet')} ${escapeHtml(formatUsdt(task.reward))}</span>
      </div>
      <h3>${escapeHtml(localize(task.title))}</h3>
      <p>${escapeHtml(localize(task.description))}</p>
      <div class="task-requirement"><span>${escapeHtml(t('requiredVip'))}</span><strong>${escapeHtml(task.requiredVipName)}</strong></div>
      <div class="task-footer">
        <span class="task-meta">${icon('clock')} ${task.minutes} ${escapeHtml(t('minutes'))}</span>
        <button class="task-button ${statusClass}" type="button" ${task.completed || task.locked ? 'disabled' : ''} data-action="open-task" data-task-id="${task.id}">${icon(actionIcon)} ${escapeHtml(actionText)}</button>
      </div>
    </article>`;
}

function renderEmptyTasks() {
  return `<div class="empty-state"><span class="stat-icon">${icon('tasks')}</span>${escapeHtml(t('emptyTasks'))}</div>`;
}

function renderHome() {
  const recommended = [...state.tasks].filter(task => !task.completed).sort((a, b) => Number(a.locked) - Number(b.locked)).slice(0, 3);
  return `<div class="page dashboard-page">
    <header class="page-heading"><div><span class="page-kicker">${escapeHtml(t('greeting', state.user.name))}</span><h1>${escapeHtml(t('overview'))}</h1><p>${escapeHtml(t('overviewText'))}</p></div><button class="secondary-button heading-action" type="button" data-action="view" data-view="wallet">${icon('wallet')}${escapeHtml(t('walletTitle'))}</button></header>
    ${renderMetrics()}
    <div class="dashboard-grid">${renderEarnings()}${renderMembership()}
      <section class="daily-panel"><div class="section-heading"><div><h2>${escapeHtml(t('navTasks'))}</h2><p>${state.tasks.filter(task => !task.locked && !task.completed).length} ${escapeHtml(t('taskAvailable'))}</p></div><button class="text-button" type="button" data-action="view" data-view="tasks">${escapeHtml(t('viewAll'))}${icon('arrow')}</button></div><div class="daily-task-list">${recommended.map(renderTaskRow).join('') || renderEmptyTasks()}</div></section>
      <section class="recent-panel"><div class="section-heading"><h2>${escapeHtml(t('historyTitle'))}</h2><button class="icon-button" type="button" data-action="view" data-view="wallet" aria-label="${escapeHtml(t('viewAll'))}" title="${escapeHtml(t('viewAll'))}">${icon('arrow')}</button></div>${renderActivityList(3)}</section>
    </div>
    <div class="mobile-wallet-actions"><button type="button" data-action="open-wallet" data-wallet-type="deposit">${icon('deposit')}${escapeHtml(t('deposit'))}</button><button type="button" data-action="open-wallet" data-wallet-type="withdraw">${icon('withdraw')}${escapeHtml(t('withdraw'))}</button><button type="button" data-action="open-wallet" data-wallet-type="transfer">${icon('transfer')}${escapeHtml(t('transfer'))}</button></div>
  </div>`;
}

function filteredTasks() {
  const query = state.search.trim().toLocaleLowerCase();
  const filtered = state.tasks.filter(task => {
    if (query && !`${localize(task.title)} ${task.requiredVipName}`.toLocaleLowerCase().includes(query)) return false;
    if (state.filter === 'available') return !task.completed && !task.locked;
    if (state.filter === 'completed') return task.completed;
    if (state.filter === 'locked') return task.locked;
    return true;
  });
  if (state.sort === 'reward') filtered.sort((a, b) => b.reward - a.reward);
  if (state.sort === 'time') filtered.sort((a, b) => a.minutes - b.minutes);
  return filtered;
}

function pagination(key, total, size) {
  const pages = Math.max(1, Math.ceil(total / size));
  const page = Math.min(state[key], pages);
  return `<div class="pagination"><span>${total} ${escapeHtml(t('records'))} <span class="separator">·</span> ${page} / ${pages}</span><div><button class="icon-button" type="button" data-action="paginate" data-page-key="${key}" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''} aria-label="${escapeHtml(t('previous'))}" title="${escapeHtml(t('previous'))}">${icon('arrow', 'arrow-back')}</button><button class="icon-button" type="button" data-action="paginate" data-page-key="${key}" data-page="${page + 1}" ${page >= pages ? 'disabled' : ''} aria-label="${escapeHtml(t('next'))}" title="${escapeHtml(t('next'))}">${icon('arrow')}</button></div></div>`;
}

function renderTaskResults() {
  return `<div class="task-grid">${filteredTasks().map(renderTaskCard).join('') || renderEmptyTasks()}</div>`;
}

function renderTasksPage() {
  const filters = [['all', 'filterAll'], ['available', 'filterAvailable'], ['completed', 'filterCompleted'], ['locked', 'filterLocked']];
  return `<div class="page tasks-page">
    ${renderVisualHeader(t('tasksTitle'), t('tasksSubtitle'))}
    <div class="task-toolbar"><div class="search-field">${icon('search')}<input type="search" id="task-search" placeholder="${escapeHtml(t('taskSearch'))}" aria-label="${escapeHtml(t('taskSearch'))}" value="${escapeHtml(state.search)}" /></div><select class="sort-select" data-task-sort aria-label="${escapeHtml(t('taskSort'))}"><option value="default" ${state.sort === 'default' ? 'selected' : ''}>${escapeHtml(t('sortDefault'))}</option><option value="reward" ${state.sort === 'reward' ? 'selected' : ''}>${escapeHtml(t('sortReward'))}</option><option value="time" ${state.sort === 'time' ? 'selected' : ''}>${escapeHtml(t('sortTime'))}</option></select></div>
    <div class="filter-tabs">${filters.map(([value, key]) => `<button class="filter-button ${state.filter === value ? 'active' : ''}" type="button" data-action="filter" data-filter="${value}">${escapeHtml(t(key))}<span>${state.tasks.filter(task => value === 'all' || (value === 'available' && !task.locked && !task.completed) || (value === 'completed' && task.completed) || (value === 'locked' && task.locked)).length}</span></button>`).join('')}</div>
    <div id="task-results">${renderTaskResults()}</div>
  </div>`;
}

function renderVipPage() {
  const plans = state.vips;
  return `<div class="page vip-page">${renderVisualHeader(t('vipTitle'), t('vipSubtitle'))}
    <div class="vip-account-strip"><span>${icon('wallet')}${escapeHtml(t('lockedAccount'))}<strong>${escapeHtml(formatUsdt(state.user.lockedBalance))}</strong></span><button class="text-button" type="button" data-action="open-wallet" data-wallet-type="deposit">${icon('deposit')}${escapeHtml(t('deposit'))}</button></div>
    <div class="vip-grid">${plans.map(plan => {
      const enough = state.user.lockedBalance >= plan.upgradeCost;
      const disabled = !plan.available || !enough;
      return `<article class="vip-card ${plan.current ? 'current' : ''}"><div class="vip-head"><span class="vip-icon">${icon('crown')}</span><strong>${escapeHtml(plan.name)}</strong>${plan.current ? `<span class="status-pill">${escapeHtml(t(plan.active ? 'active' : 'freeExpired'))}</span>` : `<span class="plan-number">${String(plan.level).padStart(2, '0')}</span>`}</div><div class="vip-price">${escapeHtml(formatUsdt(plan.price))}</div><div class="vip-features"><span>${icon('clock')}${plan.durationDays} ${escapeHtml(t('days'))}</span><span>${icon('tasks')} ${plan.dailyTasks} ${escapeHtml(t('dailyTask'))}</span><span>${icon('wallet')}${escapeHtml(formatUsdt(plan.maxReward))} <small>${escapeHtml(t('reward'))}</small></span><span>${icon('users')}${plan.teamRate}% <small>${escapeHtml(t('teamRate'))}</small></span></div><div class="upgrade-line"><span>${escapeHtml(t('upgradeCost'))}</span><strong>${escapeHtml(formatUsdt(plan.upgradeCost))}</strong></div><button class="${plan.current ? 'secondary-button' : 'primary-button'}" type="button" data-action="buy-vip" data-vip-id="${plan.id}" ${disabled ? 'disabled' : ''}>${escapeHtml(plan.active ? t('active') : plan.current && plan.available ? t('renewVip') : enough ? t('buyVip') : t('notEnoughLocked'))}</button></article>`;
    }).join('')}</div></div>`;
}

function renderTeamPage() {
  const team = state.team || { inviteCode: state.user.inviteCode, count: 0, totalLocked: 0, totalEarned: 0, members: [] };
  return `
    <div class="page">
      ${renderVisualHeader(t('teamTitle'), t('teamSubtitle'), '/assets/taskmall-team-office.png', 'TaskMall Team')}
      <section class="team-grid">
        <article class="invite-card">
          <span class="stat-icon purple">${icon('users')}</span>
          <span>${escapeHtml(t('inviteCode'))}</span>
          <strong>${escapeHtml(team.inviteCode)}</strong>
          <button class="secondary-button" type="button" data-action="copy-invite">${icon('copy')} ${escapeHtml(t('copyCode'))}</button>
        </article>
        <article class="stat-card"><span class="stat-icon">${icon('users')}</span><div><strong class="stat-value">${team.count}</strong><span class="stat-label">${escapeHtml(t('teamMembers'))}</span></div></article>
        <article class="stat-card"><span class="stat-icon green">${icon('lock')}</span><div><strong class="stat-value">${escapeHtml(formatUsdt(team.totalLocked))}</strong><span class="stat-label">${escapeHtml(t('teamVolume'))}</span></div></article>
        <article class="stat-card"><span class="stat-icon yellow">${icon('wallet')}</span><div><strong class="stat-value">${escapeHtml(formatUsdt(team.totalEarned))}</strong><span class="stat-label">${escapeHtml(t('teamEarned'))}</span></div></article>
      </section>
      <section class="activity-card team-list">
        ${team.members.length ? `<div class="activity-list">${team.members.map((member) => `<article class="activity-item"><span class="activity-icon">${icon('profile')}</span><div><strong class="activity-title">${escapeHtml(member.name)}</strong><span class="activity-date">${escapeHtml(member.vipName)} · ${escapeHtml(formatDate(member.createdAt))}</span></div><span class="activity-points">${escapeHtml(formatUsdt(member.earnedTotal))}</span></article>`).join('')}</div>` : `<div class="empty-state"><span class="stat-icon">${icon('users')}</span><strong>${escapeHtml(t('emptyTeamTitle'))}</strong><p>${escapeHtml(t('emptyTeamText'))}</p></div>`}
      </section>
    </div>`;
}

function activityTitle(activity) {
  if (activity.type === 'task') return localize(activity.title) || t('activityTask');
  if (activity.type === 'deposit') return t('activityDeposit');
  if (activity.type === 'withdraw') return t('activityWithdraw');
  if (activity.type === 'transfer') return t('activityTransfer');
  if (activity.type === 'vip') return `${t('activityVip')} ${activity.vipName || ''}`.trim();
  if (activity.type === 'welcome') return t('activityWelcome');
  return t('historyTitle');
}

function activityAmount(activity) {
  if (!activity.amount) return '—';
  if (activity.type === 'withdraw' && activity.netAmount !== undefined) {
    return `-${formatUsdt(activity.amount)} / ${formatUsdt(activity.netAmount)}`;
  }
  const sign = activity.type === 'withdraw' || activity.type === 'vip' ? '-' : '+';
  if (activity.type === 'transfer') return `→ ${formatUsdt(activity.amount)}`;
  return `${sign}${formatUsdt(activity.amount)}`;
}

function renderActivityList(limit = 0) {
  const items = limit ? state.activities.slice(0, limit) : state.activities;
  if (!items.length) return `<div class="empty-state"><span class="stat-icon">${icon('info')}</span>${escapeHtml(t('noHistory'))}</div>`;
  const activityIcons = { task: 'check', deposit: 'deposit', withdraw: 'withdraw', transfer: 'transfer', vip: 'crown', welcome: 'spark' };
  return `<div class="activity-list">${items.map((activity) => `<article class="activity-item"><span class="activity-icon">${icon(activityIcons[activity.type] || 'info')}</span><div><strong class="activity-title">${escapeHtml(activityTitle(activity))}</strong><span class="activity-date">${escapeHtml(formatDate(activity.at))}</span></div><span class="activity-points">${escapeHtml(activityAmount(activity))}</span></article>`).join('')}</div>`;
}

function renderMePage() {
  return `<div class="page account-page">${renderVisualHeader(t('meTitle'), t('meSubtitle'))}
    <div class="me-layout"><section class="profile-summary"><div class="profile-avatar">${escapeHtml(state.user.name.charAt(0).toUpperCase())}</div><h2>${escapeHtml(state.user.name)}</h2><p>${escapeHtml(state.user.email)}</p><div class="profile-level">${icon('crown')}${escapeHtml(state.user.vipName)}</div><div class="profile-links">${[['wallet', 'wallet', 'walletTitle'], ['company', 'briefcase', 'company'], ['support', 'help', 'support']].map(([view, symbol, label]) => `<button type="button" data-action="view" data-view="${view}">${icon(symbol)}<span>${escapeHtml(t(label))}</span>${icon('chevron')}</button>`).join('')}</div></section>
      <section class="profile-settings"><h2>${escapeHtml(t('accountSettings'))}</h2><form class="profile-form" id="profile-form"><div class="field"><label for="profile-name">${escapeHtml(t('displayName'))}</label><div class="field-control">${icon('user')}<input id="profile-name" name="name" type="text" value="${escapeHtml(state.user.name)}" minlength="2" maxlength="50" required /></div></div><div class="field"><label for="profile-email">${escapeHtml(t('email'))}</label><div class="field-control">${icon('mail')}<input id="profile-email" type="email" value="${escapeHtml(state.user.email)}" disabled /></div></div><div class="profile-actions"><button class="primary-button" type="submit">${icon('save')}${escapeHtml(t('saveChanges'))}</button><button class="secondary-button danger-button" type="button" data-action="logout">${icon('logout')}${escapeHtml(t('logout'))}</button></div></form><p class="account-note">${escapeHtml(t('memberSince'))}: ${escapeHtml(formatDate(state.user.createdAt, true))}<br />${escapeHtml(t('expiresOn'))}: ${escapeHtml(formatDate(state.user.vipExpiresAt, true))}</p></section></div>
  </div>`;
}

function renderTaskDialog() {
  const task = state.tasks.find((item) => item.id === state.modalTaskId);
  if (!task) return '';
  const steps = localize(task.steps);
  return `
    <div class="dialog-backdrop" data-action="backdrop-close" role="presentation">
      <section class="dialog" role="dialog" aria-modal="true" aria-labelledby="task-dialog-title">
        <div class="dialog-head"><span class="dialog-task-icon">${icon(task.icon, 'icon-lg')}</span><button class="dialog-close" type="button" data-action="close-dialog" aria-label="${escapeHtml(t('close'))}">${icon('close')}</button></div>
        <div class="dialog-body">${renderTaskPhoto(task, 'dialog-product-image')}<span class="dialog-kicker">${escapeHtml(t('taskPlan'))}</span><h2 id="task-dialog-title">${escapeHtml(localize(task.title))}</h2><p class="dialog-description">${escapeHtml(localize(task.description))}</p><div class="dialog-meta"><span class="meta-chip">${icon('clock')} ${task.minutes} ${escapeHtml(t('minutes'))}</span><span class="meta-chip">${icon('wallet')} ${escapeHtml(formatUsdt(task.reward))}</span><span class="meta-chip">${icon('crown')} ${escapeHtml(task.requiredVipName)}</span></div><ul class="checklist">${steps.map((step, index) => `<li><label class="check-item"><input type="checkbox" data-step="${index}" /><span>${escapeHtml(step)}</span></label></li>`).join('')}</ul><button class="primary-button dialog-action" type="button" data-action="complete-task" data-task-id="${task.id}" disabled>${icon('check')} <span>${escapeHtml(t('completeChecklist'))}</span></button></div>
      </section>
    </div>`;
}

function renderHelpDialog() {
  if (!state.helpOpen) return '';
  return `
    <div class="dialog-backdrop" data-action="backdrop-close" role="presentation">
      <section class="dialog" role="dialog" aria-modal="true" aria-labelledby="help-dialog-title">
        <div class="dialog-head"><span class="dialog-task-icon">${icon('help', 'icon-lg')}</span><button class="dialog-close" type="button" data-action="close-dialog" aria-label="${escapeHtml(t('close'))}">${icon('close')}</button></div>
        <div class="dialog-body"><span class="dialog-kicker">TaskMall</span><h2 id="help-dialog-title">${escapeHtml(t('helpTitle'))}</h2><p class="dialog-description">${escapeHtml(t('helpText'))}</p><div class="help-list">${[1, 2, 3].map((number) => `<div class="help-item"><strong>${escapeHtml(t(`faq${number}q`))}</strong><p>${escapeHtml(t(`faq${number}a`))}</p></div>`).join('')}</div></div>
      </section>
    </div>`;
}

let earningsChart;
let lastModalTrigger;

function renderTransactions() {
  const size = innerHeight <= 740 ? 2 : innerHeight <= 800 ? 3 : 4;
  const items = state.activities.slice((state.activityPage - 1) * size, state.activityPage * size);
  return `<section class="transactions-panel"><div class="section-heading"><h2>${escapeHtml(t('historyTitle'))}</h2><button class="icon-button" type="button" data-action="export-history" aria-label="${escapeHtml(t('download'))}" title="${escapeHtml(t('download'))}" ${state.activities.length ? '' : 'disabled'}>${icon('download')}</button></div><div class="table-wrap"><table class="transactions-table"><thead><tr><th>${escapeHtml(t('transactionType'))}</th><th>${escapeHtml(t('transactionDate'))}</th><th>${escapeHtml(t('transactionAmount'))}</th></tr></thead><tbody>${items.map(activity => `<tr><td><span class="table-transaction">${icon({ task: 'check', deposit: 'deposit', withdraw: 'withdraw', transfer: 'transfer', vip: 'crown', welcome: 'spark' }[activity.type] || 'info')}${escapeHtml(activityTitle(activity))}</span>${activity.type === 'withdraw' && activity.status ? `<small class="withdrawal-state">${escapeHtml(t(activity.status))}</small>` : ''}${/^[a-f0-9]{64}$/.test(activity.txid || '') ? `<a class="transaction-explorer" href="https://tronscan.org/#/transaction/${activity.txid}" target="_blank" rel="noopener noreferrer">${escapeHtml(t('explorer'))}${icon('arrow')}</a>` : ''}</td><td>${escapeHtml(formatDate(activity.at))}</td><td class="table-amount">${escapeHtml(activityAmount(activity))}</td></tr>`).join('')}</tbody></table></div>${!items.length ? `<div class="empty-state">${icon('list')}<strong>${escapeHtml(t('noActivity'))}</strong><p>${escapeHtml(t('noActivityText'))}</p></div>` : ''}${pagination('activityPage', state.activities.length, size)}</section>`;
}

function renderWalletPage() {
  return `<div class="page wallet-page">${renderVisualHeader(t('walletTitle'), t('walletNote'))}${renderBalanceCards()}${state.user.reservedBalance ? `<div class="reserved-funds">${icon('clock')}<span>${escapeHtml(t('reservedFunds'))}</span><strong>${escapeHtml(formatUsdt(state.user.reservedBalance))}</strong></div>` : ''}<div class="wallet-command-bar">${[['deposit', 'deposit'], ['withdraw', 'withdraw'], ['transfer', 'transfer']].map(([type, symbol]) => `<button class="${type === 'deposit' ? 'primary-button' : 'secondary-button'}" type="button" data-action="open-wallet" data-wallet-type="${type}">${icon(symbol)}${escapeHtml(t(type))}</button>`).join('')}</div>${renderTransactions()}${!state.paymentsAvailable ? `<div class="payment-notice">${icon('info')}<span>${escapeHtml(t('paymentStatusDetail'))}</span></div>` : ''}</div>`;
}

function paymentStatusLabel() {
  if (!state.paymentsAvailable) return 'paymentStatusDetail';
  if (state.paymentMode !== 'tron-watch-only') return 'paymentsReady';
  return state.withdrawalsAvailable ? 'paymentsManual' : 'depositsReady';
}

function renderCompanyPage() {
  return `<div class="page company-page">
    <section class="company-masthead"><span class="eyebrow">TASKMALL / WORKSPACE</span><h1>TaskMall<span>.</span></h1><p>${escapeHtml(t('companySubtitle'))}</p><div class="company-signature"><img src="/favicon.svg?v=studio-2" alt="" width="68" height="68" /><span>${escapeHtml(t('platform'))}<strong>TaskMall Workspace</strong></span></div></section>
    <section class="company-intro"><span class="eyebrow">${escapeHtml(t('company'))}</span><h2>${escapeHtml(t('authBrandText'))}</h2><p>${escapeHtml(t('companyText'))}</p></section>
    <section class="company-principles">${[['shield', 1], ['users', 2], ['settings', 3]].map(([symbol, number]) => `<article><span class="principle-number">0${number}</span>${icon(symbol)}<h3>${escapeHtml(t(`companyPrinciple${number}`))}</h3><p>${escapeHtml(t(`companyPrinciple${number}Text`))}</p></article>`).join('')}</section>
    <section class="company-status"><div><h2>${escapeHtml(t('platformStatus'))}</h2><p>${escapeHtml(t(paymentStatusLabel()))}</p></div><span class="workspace-badge">TaskMall</span></section>
  </div>`;
}

function renderSupportPage() {
  return `<div class="page support-page">${renderVisualHeader(t('helpTitle'), t('helpSubtitle'))}<div class="support-layout"><section class="faq-section">${[1, 2, 3, 4].map(number => `<details class="faq-item" ${number === 1 ? 'open' : ''}><summary>${escapeHtml(t(`faq${number}q`))}${icon('chevron')}</summary><p>${escapeHtml(t(`faq${number}a`))}</p></details>`).join('')}</section><aside class="support-aside"><span class="stat-icon">${icon('help')}</span><h2>${escapeHtml(t('supportAccount'))}</h2><p>${escapeHtml(t('supportAccountText'))}</p><button class="secondary-button" type="button" data-action="${state.user ? 'view' : 'auth-home'}" data-view="me" data-mode="login">${escapeHtml(t(state.user ? 'account' : 'signin'))}${icon('arrow')}</button>${!state.paymentsAvailable ? `<div class="payment-notice">${icon('info')}<span>${escapeHtml(t('paymentStatusDetail'))}</span></div>` : ''}</aside></div></div>`;
}

function viewTitle() {
  return t({ home: 'overview', tasks: 'navTasks', wallet: 'walletTitle', vip: 'navVip', team: 'navTeam', me: 'account', company: 'company', support: 'support' }[state.view] || 'overview');
}

function renderPublicPage() {
  app.innerHTML = `<div class="public-shell"><header class="public-header"><a class="brand" href="#" data-action="auth-home">${brand()}</a><nav><button class="text-button" type="button" data-action="public-view" data-view="company">${escapeHtml(t('company'))}</button><button class="text-button" type="button" data-action="public-view" data-view="support">${escapeHtml(t('support'))}</button></nav><div>${languageSelect()}<button class="primary-button" type="button" data-action="auth-home" data-mode="login">${escapeHtml(t('signin'))}${icon('arrow')}</button></div></header><main>${state.publicView === 'support' ? renderSupportPage() : renderCompanyPage()}</main><footer class="public-footer">TaskMall &copy; 2026 <span>${escapeHtml(t('workspaceStatus'))}</span></footer></div>`;
  setDocumentLanguage();
}

function drawEarnings() {
  const canvas = document.querySelector('#earnings-chart');
  if (!canvas || !canvas.getClientRects().length) return;
  const days = weekEarnings();
  earningsChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: days.map(day => state.lang === 'ka' ? ['კვ', 'ორ', 'სა', 'ოთ', 'ხუ', 'პა', 'შა'][day.date.getDay()] : new Intl.DateTimeFormat(locale(), { weekday: 'short' }).format(day.date)),
      datasets: [{ data: days.map(day => Math.round(day.amount * 100) / 100), backgroundColor: '#176b56', hoverBackgroundColor: '#23846a', borderRadius: 4, maxBarThickness: 36 }]
    },
    options: {
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { display: false }, tooltip: { displayColors: false, callbacks: { label: context => formatUsdt(context.raw) }, backgroundColor: '#1c2925', padding: 12 } },
      scales: {
        x: { grid: { display: false }, border: { display: false }, ticks: { color: '#7a8580', font: { family: 'Inter, Georgian', size: 11 } } },
        y: { beginAtZero: true, suggestedMax: Math.max(1, ...days.map(day => day.amount)) * 1.15, border: { display: false }, grid: { color: '#edf0ee', drawTicks: false }, ticks: { maxTicksLimit: 4, color: '#7a8580', padding: 10, font: { family: 'Inter', size: 10 } } }
      }
    }
  });
}

function renderShell() {
  earningsChart?.destroy();
  const views = { home: renderHome, tasks: renderTasksPage, vip: renderVipPage, team: renderTeamPage, me: renderMePage, wallet: renderWalletPage, company: renderCompanyPage, support: renderSupportPage };
  const content = (views[state.view] || renderHome)();
  const modal = Boolean(state.modalTaskId || state.walletModal || state.helpOpen);
  app.innerHTML = `<div class="app-shell">
    <aside class="sidebar" ${modal ? 'inert' : ''}>
      <button class="brand" type="button" data-action="view" data-view="home">${brand()}</button>
      <div class="workspace-selector"><span class="workspace-avatar">TM</span><div><strong>TaskMall</strong><span>${escapeHtml(t('workspace'))}</span></div>${icon('chevron')}</div>
      <span class="nav-section-label">${escapeHtml(t('workspace'))}</span>
      <nav class="desktop-nav" aria-label="${escapeHtml(t('workspace'))}">${navItem('home', t('navHome'), 'home')}${navItem('tasks', t('navTasks'), 'tasks')}${navItem('wallet', t('walletTitle'), 'wallet')}${navItem('vip', t('navVip'), 'crown')}${navItem('team', t('navTeam'), 'users')}</nav>
      <span class="nav-section-label">${escapeHtml(t('platform'))}</span>
      <nav class="desktop-nav" aria-label="${escapeHtml(t('platform'))}">${navItem('company', t('company'), 'briefcase')}${navItem('support', t('support'), 'help')}${navItem('me', t('account'), 'settings')}</nav>
      <div class="sidebar-bottom"><button class="sidebar-user" type="button" data-action="view" data-view="me"><span class="avatar">${escapeHtml(state.user.name.charAt(0).toUpperCase())}</span><span><strong>${escapeHtml(state.user.name)}</strong><small>${escapeHtml(state.user.email)}</small></span>${icon('chevron')}</button></div>
    </aside>
    <div class="workspace-main">
      <header class="topbar" ${modal ? 'inert' : ''}><div class="topbar-left"><button class="brand mobile-brand" type="button" data-action="view" data-view="home">${brand()}</button><span class="breadcrumb">TaskMall ${icon('chevron')}<strong>${escapeHtml(viewTitle())}</strong></span></div><div class="topbar-actions"><span class="topbar-date">${escapeHtml(formatDate(new Date(), true))}</span>${languageSelect('top-language')}<button class="icon-button topbar-help" type="button" data-action="help" aria-label="${escapeHtml(t('help'))}" title="${escapeHtml(t('help'))}">${icon('help')}</button><button class="avatar-button" type="button" data-action="view" data-view="me" aria-label="${escapeHtml(t('account'))}" title="${escapeHtml(t('account'))}">${escapeHtml(state.user.name.charAt(0).toUpperCase())}</button><button class="icon-button mobile-menu-toggle" type="button" data-action="mobile-menu" aria-label="${escapeHtml(t('menu'))}" aria-expanded="${state.mobileMenu}">${icon(state.mobileMenu ? 'close' : 'menu')}</button></div></header>
      ${state.mobileMenu ? `<nav class="mobile-menu" aria-label="${escapeHtml(t('menu'))}">${navItem('wallet', t('walletTitle'), 'wallet')}${navItem('company', t('company'), 'briefcase')}${navItem('support', t('support'), 'help')}</nav>` : ''}
      <main class="app-content" ${modal ? 'inert' : ''}>${content}</main>
      <footer class="workspace-footer"><span>TaskMall &copy; 2026</span><span>${escapeHtml(t('workspaceStatus'))}</span></footer>
    </div>
    <nav class="bottom-nav" aria-label="Mobile" ${modal ? 'inert' : ''}>${navItem('home', t('navHome'), 'home', true)}${navItem('tasks', t('navTasks'), 'tasks', true)}${navItem('vip', t('navVip'), 'crown', true)}${navItem('team', t('navTeam'), 'users', true)}${navItem('me', t('navMe'), 'profile', true)}</nav>
    ${state.modalTaskId ? renderTaskDialog() : ''}${renderWalletDialog()}${renderHelpDialog()}
  </div>`;
  setDocumentLanguage();
  drawEarnings();
  if (modal) requestAnimationFrame(() => document.querySelector('.dialog-close')?.focus());
  else if (lastModalTrigger) {
    const trigger = lastModalTrigger;
    const candidates = [...document.querySelectorAll('[data-action]')];
    const button = candidates.find(element => element.dataset.action === trigger.action && (!trigger.task || element.dataset.taskId === trigger.task) && (!trigger.wallet || element.dataset.walletType === trigger.wallet) && element.getClientRects().length);
    requestAnimationFrame(() => button?.focus());
    lastModalTrigger = null;
  }
}

function render() {
  if (state.loading) return renderLoading();
  if (!state.user && state.publicView) return renderPublicPage();
  if (!state.user) return renderAuth();
  return renderShell();
}

async function loadPrivateData() {
  const [tasksData, activityData, vipData, teamData, paymentConfig] = await Promise.all([
    api('/api/tasks'),
    api('/api/activity'),
    api('/api/vips'),
    api('/api/team'),
    api('/api/payment-config')
  ]);
  state.tasks = tasksData.tasks;
  state.activities = activityData.activities;
  state.vips = vipData.vips;
  state.team = teamData.team;
  state.paymentsAvailable = paymentConfig.available;
  state.paymentMode = paymentConfig.mode || '';
  state.withdrawalsAvailable = paymentConfig.withdrawalsAvailable ?? paymentConfig.available;
  state.minimumWithdrawalAmount = paymentConfig.minimumWithdrawalAmount || 10;
  paymentNetworks.splice(0, paymentNetworks.length, ...paymentConfig.networks);
  if (state.paymentMode === 'tron-watch-only' && state.paymentsAvailable) {
    try { state.depositWallet = await api('/api/wallet/deposit-address', { method: 'POST', body: {} }); }
    catch { state.depositWallet = null; state.paymentsAvailable = false; }
  } else state.depositWallet = null;
}

async function refreshAfterAction(result = {}) {
  if (result.user) state.user = result.user;
  if (result.activities) state.activities = result.activities;
  if (result.vips) state.vips = result.vips;
  await loadPrivateData();
  render();
}

async function handleAuthSubmit(form) {
  if (state.busy) return;
  const data = new FormData(form);
  const message = form.querySelector('#auth-message');
  const button = form.querySelector('button[type="submit"]');
  if (state.authMode === 'signup' && data.get('password') !== data.get('confirm')) {
    message.textContent = t('passwordMismatch');
    return;
  }
  state.busy = true;
  button.disabled = true;
  message.textContent = '';
  try {
    const email = data.get('email');
    const result = await api(state.authMode === 'signup' ? '/api/auth/signup' : '/api/auth/login', {
      method: 'POST',
      body: { name: displayNameFromEmail(email), email, password: data.get('password'), referral: data.get('referral') }
    });
    state.user = result.user;
    state.view = 'home';
    history.replaceState(null, '', '#home');
    await loadPrivateData();
    render();
  } catch (error) {
    message.textContent = friendlyError(error);
    button.disabled = false;
  } finally {
    state.busy = false;
  }
}

async function completeTask(taskId, button) {
  if (state.busy) return;
  state.busy = true;
  button.disabled = true;
  try {
    const result = await api(`/api/tasks/${encodeURIComponent(taskId)}/complete`, { method: 'POST' });
    state.modalTaskId = null;
    await refreshAfterAction(result);
    showToast(t('taskSuccess', formatUsdt(result.task.reward)));
  } catch (error) {
    button.disabled = false;
    showToast(friendlyError(error), 'error');
  } finally {
    state.busy = false;
  }
}

async function buyVip(vipId, button) {
  if (state.busy) return;
  state.busy = true;
  button.disabled = true;
  try {
    const result = await api(`/api/vips/${encodeURIComponent(vipId)}/buy`, { method: 'POST' });
    await refreshAfterAction(result);
    showToast(t('vipSuccess', result.user.vipName));
  } catch (error) {
    button.disabled = false;
    showToast(friendlyError(error), 'error');
  } finally {
    state.busy = false;
  }
}

async function walletAction(type, form) {
  if (state.busy) return;
  const button = form.querySelector('button[type="submit"]');
  const data = new FormData(form);
  const endpoints = { deposit: '/api/wallet/deposit', withdraw: '/api/wallet/withdraw', transfer: '/api/wallet/transfer' };
  const success = { deposit: 'depositSuccess', withdraw: 'withdrawSuccess', transfer: 'transferSuccess' };
  state.busy = true;
  button.disabled = true;
  try {
    const body = { amount: data.get('amount') };
    if (data.has('wallet')) body.wallet = data.get('wallet');
    if (data.has('network')) body.network = data.get('network');
    if (type === 'withdraw' && state.paymentMode === 'tron-watch-only') {
      form.dataset.requestKey ||= crypto.randomUUID();
      body.requestKey = form.dataset.requestKey;
      body.password = data.get('password');
    }
    const result = await api(endpoints[type], {
      method: 'POST',
      body
    });
    form.reset();
    state.walletModal = null;
    await refreshAfterAction(result);
    showToast(t(success[type]));
  } catch (error) {
    button.disabled = false;
    showToast(friendlyError(error), 'error');
  } finally {
    state.busy = false;
  }
}

async function saveProfile(form) {
  if (state.busy) return;
  const button = form.querySelector('button[type="submit"]');
  state.busy = true;
  button.disabled = true;
  try {
    const result = await api('/api/profile', { method: 'PATCH', body: { name: new FormData(form).get('name') } });
    state.user = result.user;
    render();
    showToast(t('profileSaved'));
  } catch (error) {
    button.disabled = false;
    showToast(friendlyError(error), 'error');
  } finally {
    state.busy = false;
  }
}

function exportHistory() {
  const quote = (value) => {
    const text = String(value ?? '');
    const safe = /^[=+@-]/.test(text) ? "'" + text : text;
    return '"' + safe.replaceAll('"', '""') + '"';
  };
  const rows = [
    [t('transactionType'), t('transactionDate'), t('transactionAmount'), 'Type', 'Status', 'Net USDT', 'Fee USDT', 'TxID'],
    ...state.activities.map(activity => [activityTitle(activity), activity.at, Number(activity.amount) || 0, activity.type,
      activity.status || '', activity.netAmount ?? '', activity.fee ?? '', activity.txid || ''])
  ];
  const blob = new Blob(['\uFEFF' + rows.map(row => row.map(quote).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'taskmall-transactions.csv';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

app.addEventListener('input', (event) => {
  if (event.target.name === 'amount' && event.target.closest('[data-wallet-form="withdraw"]')) {
    const output = event.target.form.querySelector('[data-withdraw-net]');
    if (output) {
      const value = event.target.value;
      let net = 0;
      if (/^\d+(\.\d{1,6})?$/.test(value) && Number(value) <= 100000) {
        const [whole, fraction = ''] = value.split('.');
        const gross = BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0'));
        net = Number(gross - (gross + 5n) / 10n) / 1000000;
      }
      output.textContent = formatUsdt(net);
    }
  }
  if (event.target.id !== 'task-search') return;
  state.search = event.target.value;
  document.querySelector('#task-results').innerHTML = renderTaskResults();
});

app.addEventListener('submit', (event) => {
  event.preventDefault();
  if (event.target.id === 'auth-form') handleAuthSubmit(event.target);
  if (event.target.id === 'profile-form') saveProfile(event.target);
  if (event.target.dataset.walletForm) walletAction(event.target.dataset.walletForm, event.target);
});

app.addEventListener('change', (event) => {
  if (event.target.matches('[data-language-select]')) {
    state.lang = event.target.value;
    localStorage.setItem('taskmall_language', state.lang);
    render();
    return;
  }
  if (event.target.matches('[data-task-sort]')) {
    state.sort = event.target.value;
    render();
    return;
  }
  if (event.target.matches('[data-deposit-network]')) {
    const form = event.target.closest('form');
    const addressInput = form?.querySelector('[data-deposit-address]');
    if (addressInput) addressInput.value = paymentNetwork(event.target.value).address;
    return;
  }
  if (!event.target.matches('[data-step]')) return;
  const checks = [...document.querySelectorAll('[data-step]')];
  const actionButton = document.querySelector('[data-action="complete-task"]');
  const ready = checks.length > 0 && checks.every((check) => check.checked);
  actionButton.disabled = !ready;
  actionButton.querySelector('span').textContent = ready ? t('completeTask') : t('completeChecklist');
});

app.addEventListener('click', async (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;

  if (action === 'auth-home') {
    event.preventDefault();
    state.publicView = null;
    if (target.dataset.mode) state.authMode = target.dataset.mode;
    history.replaceState(null, '', location.pathname + location.search);
    render();
  }
  if (action === 'public-view') {
    state.publicView = target.dataset.view;
    history.pushState(null, '', `#${state.publicView}`);
    render();
  }
  if (action === 'mobile-menu') {
    state.mobileMenu = !state.mobileMenu;
    render();
  }
  if (action === 'paginate') {
    const key = target.dataset.pageKey;
    if (key === 'activityPage') state[key] = Math.max(1, Number(target.dataset.page) || 1);
    render();
  }
  if (action === 'export-history') exportHistory();
  if (['open-wallet', 'open-task', 'help'].includes(action)) {
    lastModalTrigger = { action, task: target.dataset.taskId, wallet: target.dataset.walletType };
  }
  if (action === 'auth-mode') {
    state.authMode = target.dataset.mode;
    render();
  }
  if (action === 'toggle-password') {
    const input = document.getElementById(target.dataset.target);
    input.type = input.type === 'password' ? 'text' : 'password';
    target.setAttribute('aria-pressed', String(input.type === 'text'));
    target.setAttribute('aria-label', t(input.type === 'text' ? 'hidePassword' : 'showPassword'));
    target.title = t(input.type === 'text' ? 'hidePassword' : 'showPassword');
    target.innerHTML = icon(input.type === 'password' ? 'eye' : 'eyeOff');
  }
  if (action === 'view') {
    state.view = target.dataset.view;
    state.mobileMenu = false;
    history.pushState(null, '', `#${state.view}`);
    state.modalTaskId = null;
    state.walletModal = null;
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  if (action === 'filter') {
    state.filter = target.dataset.filter;
    render();
  }
  if (action === 'open-task') {
    state.modalTaskId = target.dataset.taskId;
    render();
  }
  if (action === 'buy-vip') buyVip(target.dataset.vipId, target);
  if (action === 'open-wallet') {
    state.walletModal = target.dataset.walletType;
    state.modalTaskId = null;
    state.helpOpen = false;
    render();
  }
  if (action === 'copy-invite') {
    try {
      await navigator.clipboard.writeText(state.team?.inviteCode || state.user.inviteCode);
      showToast(t('copied'));
    } catch {
      showToast(state.team?.inviteCode || state.user.inviteCode);
    }
  }
  if (action === 'copy-deposit-address') {
    const form = target.closest('form');
    const address = form?.querySelector('[data-deposit-address]')?.value || paymentNetwork(form?.querySelector('[data-deposit-network]')?.value).address;
    try {
      await navigator.clipboard.writeText(address);
      showToast(t('addressCopied'));
    } catch {
      showToast(address);
    }
  }
  if (action === 'copy-native-deposit' && state.depositWallet) {
    try { await navigator.clipboard.writeText(state.depositWallet.address); showToast(t('addressCopied')); }
    catch { showToast(state.depositWallet.address); }
  }
  if (action === 'close-dialog') {
    state.modalTaskId = null;
    state.walletModal = null;
    state.helpOpen = false;
    render();
  }
  if (action === 'backdrop-close' && event.target === target) {
    state.modalTaskId = null;
    state.walletModal = null;
    state.helpOpen = false;
    render();
  }
  if (action === 'complete-task') completeTask(target.dataset.taskId, target);
  if (action === 'help') {
    state.helpOpen = true;
    render();
  }
  if (action === 'logout') {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* local logout still proceeds */ }
    state.user = null;
    state.tasks = [];
    state.activities = [];
    state.vips = [];
    state.team = null;
    state.walletModal = null;
    state.authMode = 'login';
    history.replaceState(null, '', location.pathname + location.search);
    state.publicView = null;
    state.mobileMenu = false;
    state.modalTaskId = null;
    state.helpOpen = false;
    render();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Tab') {
    const dialog = document.querySelector('.dialog');
    if (dialog) {
      const items = [...dialog.querySelectorAll('button:not(:disabled), input:not(:disabled), select, summary, a[href]')].filter(element => element.getClientRects().length);
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }
  if (event.key === 'Escape' && (state.modalTaskId || state.walletModal || state.helpOpen)) {
    state.modalTaskId = null;
    state.walletModal = null;
    state.helpOpen = false;
    render();
  }
});

window.addEventListener('popstate', () => {
  const view = location.hash.slice(1);
  if (!state.user) {
    state.publicView = ['company', 'support'].includes(view) ? view : null;
    render();
    return;
  }
  if (!state.user || !['home', 'tasks', 'wallet', 'vip', 'team', 'me', 'company', 'support'].includes(view)) return;
  state.view = view;
  state.modalTaskId = null;
  state.walletModal = null;
  state.helpOpen = false;
  state.mobileMenu = false;
  render();
});

matchMedia('(max-width: 760px)').addEventListener('change', () => {
  render();
});

for (const query of ['(max-height: 740px)', '(max-height: 800px)']) {
  matchMedia(query).addEventListener('change', () => {
    state.activityPage = 1;
    render();
  });
}

async function init() {
  render();
  try {
    const paymentConfig = await api('/api/payment-config');
    state.paymentsAvailable = paymentConfig.available;
    paymentNetworks.splice(0, paymentNetworks.length, ...paymentConfig.networks);
    const result = await api('/api/me');
    state.user = result.user;
    await loadPrivateData();
    const view = location.hash.slice(1);
    if (['home', 'tasks', 'wallet', 'vip', 'team', 'me', 'company', 'support'].includes(view)) state.view = view;
  } catch {
    state.user = null;
    const view = location.hash.slice(1);
    state.publicView = ['company', 'support'].includes(view) ? view : null;
  } finally {
    state.loading = false;
    render();
  }
}

init();

let walletRefreshRunning = false;
setInterval(async () => {
  if (walletRefreshRunning || !state.user || state.paymentMode !== 'tron-watch-only' || document.hidden || state.busy) return;
  walletRefreshRunning = true;
  const userId = state.user.id;
  try {
    const [account, activity, config] = await Promise.all([api('/api/me'), api('/api/activity'), api('/api/payment-config')]);
    if (state.user?.id !== userId) return;
    const credited = account.user.lockedBalance > state.user.lockedBalance && activity.activities.some(item =>
      item.type === 'deposit' && !state.activities.some(previous => previous.id === item.id));
    const changed = JSON.stringify(account.user) !== JSON.stringify(state.user) || JSON.stringify(activity.activities) !== JSON.stringify(state.activities)
      || state.paymentsAvailable !== config.available || state.withdrawalsAvailable !== config.withdrawalsAvailable
      || state.minimumWithdrawalAmount !== config.minimumWithdrawalAmount;
    state.user = account.user;
    state.activities = activity.activities;
    state.paymentsAvailable = config.available;
    state.withdrawalsAvailable = config.withdrawalsAvailable;
    state.minimumWithdrawalAmount = config.minimumWithdrawalAmount || 10;
    if (!config.available) state.depositWallet = null;
    else if (!state.depositWallet) {
      const wallet = await api('/api/wallet/deposit-address', { method: 'POST', body: {} });
      if (state.user?.id !== userId) return;
      state.depositWallet = wallet;
    }
    if (changed && (!state.walletModal || state.walletModal === 'deposit') && !state.modalTaskId && state.view !== 'me') render();
    if (credited) showToast(t('depositReceived'));
  } catch { /* Network interruptions do not change locally displayed balances. */ }
  finally { walletRefreshRunning = false; }
}, 20_000);
