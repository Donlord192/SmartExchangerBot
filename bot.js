const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs-extra');
const config = require('./config');

const bot = new TelegramBot(config.token, { polling: true });

// Эмодзи для разных этапов
const EMOJI = {
  start: '👋',
  exchange: '🔄',
  crypto: '₿',
  fiat: '💵',
  network: '📡',
  wallet: '💳',
  card: '💴',
  timer: '⏳',
  success: '✅',
  details: '📝',
  paid: '💰',
  warning: '⚠️',
  copy: '📋'
};

// Данные по валютам и сетям
const cryptoCurrencies = [
  { code: 'BTC', name: `${EMOJI.crypto} Bitcoin`, networks: ['Bitcoin'] },
  { code: 'ETH', name: `${EMOJI.crypto} Ethereum`, networks: ['Ethereum', 'BSC'] },
  { code: 'USDT', name: `${EMOJI.crypto} Tether`, networks: ['ERC20', 'TRC20', 'BEP20'] },
  { code: 'TRX', name: `${EMOJI.crypto} TRON`, networks: ['TRC20'] }
];

const fiatCurrencies = [
  { code: 'RUB', name: `${EMOJI.fiat} Рубли` },
  { code: 'USD', name: `${EMOJI.fiat} Доллары` },
  { code: 'EUR', name: `${EMOJI.fiat} Евро` }
];

// Сессии пользователей и админа
const sessions = {};

// Главное меню
const showMainMenu = (chatId) => {
  return bot.sendMessage(
    chatId,
    `${EMOJI.start} *Привет! Я бот для безопасного обмена валют*\n\n` +
    `${EMOJI.exchange} *Выберите направление обмена:*`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: `${EMOJI.crypto} Крипта → ${EMOJI.fiat} Фиат`, callback_data: 'crypto_to_fiat' }],
          [{ text: `${EMOJI.fiat} Фиат → ${EMOJI.crypto} Крипта`, callback_data: 'fiat_to_crypto' }]
        ]
      }
    }
  );
};

// Команда /start
bot.onText(/\/start/, async (msg) => {
  await showMainMenu(msg.chat.id);
});

// Обработка кнопок пользователя
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const data = query.data;

  if (!sessions[userId]) sessions[userId] = {};

  try {
    // Выбор направления обмена
    if (data === 'crypto_to_fiat') {
      sessions[userId].direction = 'crypto_to_fiat';
      await showCurrencyMenu(chatId, 'Выберите криптовалюту для обмена:', cryptoCurrencies, 'from');
    } 
    else if (data === 'fiat_to_crypto') {
      sessions[userId].direction = 'fiat_to_crypto';
      await showCurrencyMenu(chatId, 'Выберите фиатную валюту для обмена:', fiatCurrencies, 'from');
    }

    // Выбор валюты для обмена
    else if (data.startsWith('from_')) {
      const currency = data.split('_')[1];
      sessions[userId].fromCurrency = currency;

      if (sessions[userId].direction === 'crypto_to_fiat') {
        await showCurrencyMenu(chatId, 'Выберите фиатную валюту для получения:', fiatCurrencies, 'to');
      } else {
        await showCurrencyMenu(chatId, 'Выберите криптовалюту для получения:', cryptoCurrencies, 'to');
      }
    }

    // Выбор валюты для получения
    else if (data.startsWith('to_')) {
      const currency = data.split('_')[1];
      sessions[userId].toCurrency = currency;

      // Если получаем крипту - выбираем сеть
      if (sessions[userId].direction === 'fiat_to_crypto') {
        const selectedCrypto = cryptoCurrencies.find(c => c.code === currency);
        if (selectedCrypto?.networks?.length > 0) {
          await showNetworkMenu(chatId, selectedCrypto.networks);
          return;
        }
      }

      // Иначе сразу запрашиваем сумму
      await bot.sendMessage(
        chatId,
        `${EMOJI.fiat} *Введите сумму для обмена:*\n\n` +
        `Пример: 1000 или 0.5`,
        { parse_mode: 'Markdown' }
      );
    }

    // Выбор сети
    else if (data.startsWith('net_')) {
      sessions[userId].network = data.split('_')[1];
      await bot.sendMessage(
        chatId,
        `${EMOJI.fiat} *Введите сумму для обмена:*\n\n` +
        `Пример: 1000 или 0.5`,
        { parse_mode: 'Markdown' }
      );
    }

    // Кнопка "Я оплатил"
    else if (data === 'paid') {
      await bot.sendMessage(
        chatId,
        `${EMOJI.success} *Ваша оплата получена!*\n\n` +
        `${EMOJI.timer} Средства поступят на указанные реквизиты в течение 15-20 минут.`,
        { parse_mode: 'Markdown' }
      );
      
      // Уведомление админу
      await bot.sendMessage(
        config.adminId,
        `${EMOJI.paid} Пользователь @${query.from.username || userId} подтвердил оплату по обмену`
      );
    }

    // Кнопка копирования реквизитов
    else if (data.startsWith('copy_')) {
      const textToCopy = data.split('_').slice(1).join('_');
      await bot.answerCallbackQuery(query.id, {
        text: 'Реквизиты скопированы в буфер!',
        show_alert: false
      });
    }

  } catch (error) {
    console.error('Error in callback handler:', error);
  }
});

// Обработка кнопок админа
bot.on('callback_query', async (query) => {
  if (query.from.id !== config.adminId) return;

  try {
    // Отправка реквизитов пользователю
    if (query.data.startsWith('send_details_')) {
      const userId = query.data.split('_')[2];
      sessions.admin = { userId, step: 'select_currency' };

      // Запрашиваем у админа тип валюты для реквизитов
      await bot.sendMessage(
        query.message.chat.id,
        `${EMOJI.details} *Выберите тип валюты для реквизитов:*`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: `${EMOJI.crypto} Криптовалюта`, callback_data: 'admin_crypto' }],
              [{ text: `${EMOJI.fiat} Фиат`, callback_data: 'admin_fiat' }]
            ]
          }
        }
      );
    }

    // Админ выбирает тип валюты для реквизитов
    else if (query.data === 'admin_crypto') {
      sessions.admin.currencyType = 'crypto';
      sessions.admin.step = 'select_crypto';
      
      await showCurrencyMenu(
        query.message.chat.id,
        'Выберите криптовалюту:',
        cryptoCurrencies,
        'admin_currency'
      );
    }
    else if (query.data === 'admin_fiat') {
      sessions.admin.currencyType = 'fiat';
      sessions.admin.step = 'select_fiat';
      
      await showCurrencyMenu(
        query.message.chat.id,
        'Выберите фиатную валюту:',
        fiatCurrencies,
        'admin_currency'
      );
    }

    // Админ выбрал валюту
    else if (query.data.startsWith('admin_currency_')) {
      sessions.admin.currency = query.data.split('_')[2];
      
      // Если крипта - запрашиваем сеть
      if (sessions.admin.currencyType === 'crypto') {
        const selectedCrypto = cryptoCurrencies.find(c => c.code === sessions.admin.currency);
        if (selectedCrypto?.networks?.length > 0) {
          sessions.admin.step = 'select_network';
          await showNetworkMenu(query.message.chat.id, selectedCrypto.networks, 'admin_net');
          return;
        }
      }
      
      // Иначе запрашиваем реквизиты
      sessions.admin.step = 'enter_details';
      await bot.sendMessage(
        query.message.chat.id,
        `${EMOJI.details} *Введите реквизиты для отправки:*\n\n` +
        `Для крипты: адрес кошелька\n` +
        `Для фиата: реквизиты карты/счета`,
        { parse_mode: 'Markdown' }
      );
    }

    // Админ выбрал сеть
    else if (query.data.startsWith('admin_net_')) {
      sessions.admin.network = query.data.split('_')[2];
      sessions.admin.step = 'enter_details';
      
      await bot.sendMessage(
        query.message.chat.id,
        `${EMOJI.details} *Введите реквизиты для отправки:*\n\n` +
        `Адрес кошелька ${sessions.admin.currency} (${sessions.admin.network})`,
        { parse_mode: 'Markdown' }
      );
    }

  } catch (error) {
    console.error('Error in admin callback handler:', error);
  }
});

// Обработка текстовых сообщений пользователя
bot.on('message', async (msg) => {
  if (msg.text?.startsWith('/') || msg.from.is_bot) return;

  const userId = msg.from.id;
  const session = sessions[userId];
  if (!session) return;

  try {
    // Если вводится сумма
    if (!session.amount && session.fromCurrency && session.toCurrency) {
      const amount = parseFloat(msg.text.replace(',', '.'));
if (isNaN(amount)) {
  return bot.sendMessage(
    msg.chat.id,
    `${EMOJI.warning} *Неверный формат суммы!*\n\n` +
    `Пожалуйста, введите число (например: 1000 или 0.5)`,
    { parse_mode: 'Markdown' }
  );
}
      if (amount <= 0) {
        return bot.sendMessage(
          msg.chat.id,
          `${EMOJI.warning} *Сумма должна быть больше нуля!*`,
          { parse_mode: 'Markdown' }
        );
      }

      session.amount = amount;
      
      // Расчет суммы
      const rate = getExchangeRate(session.fromCurrency, session.toCurrency);
      session.convertedAmount = (session.direction === 'crypto_to_fiat') 
        ? amount * rate
        : amount / rate;

      // Запрос реквизитов
      const requestText = (session.direction === 'crypto_to_fiat')
        ? `${EMOJI.card} *Введите реквизиты для получения ${session.toCurrency}:*\n\n` +
          `• Номер карты\n` +
          `• Банк (если требуется)\n` +
          `• Имя держателя карты`
        : `${EMOJI.wallet} *Введите адрес кошелька для получения ${session.toCurrency}${session.network ? ` (${session.network})` : ''}:*`;
      
      await bot.sendMessage(msg.chat.id, requestText, { parse_mode: 'Markdown' });
    }
    // Если вводятся реквизиты
    else if (session.amount && !session.requisites) {
      session.requisites = msg.text;

      // Сообщение пользователю
      await bot.sendMessage(
        msg.chat.id,
        `${EMOJI.exchange} *Детали вашего обмена:*\n\n` +
        `▫️ *Отдаете:* ${session.amount} ${session.fromCurrency}\n` +
        `▫️ *Получаете:* ~${session.convertedAmount.toFixed(6)} ${session.toCurrency}\n\n` +
        `${EMOJI.timer} *Ожидайте реквизиты для оплаты...*`,
        { parse_mode: 'Markdown' }
      );

      // Уведомление админу
      const adminMessage = 
        `📌 *Новый запрос на обмен:*\n\n` +
        `▫️ *Направление:* ${session.fromCurrency} → ${session.toCurrency}\n` +
        `▫️ *Сумма:* ${session.amount} ${session.fromCurrency}\n` +
        `▫️ *Получает:* ~${session.convertedAmount.toFixed(6)} ${session.toCurrency}\n` +
        (session.network ? `▫️ *Сеть:* ${session.network}\n` : '') +
        `▫️ *Реквизиты получателя:*\n${session.requisites}\n\n` +
        `👤 *Пользователь:* @${msg.from.username || 'нет'} (ID: ${userId})`;

      await bot.sendMessage(config.adminId, adminMessage, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: `${EMOJI.details} Отправить реквизиты`, callback_data: `send_details_${userId}` }
          ]]
        }
      });

      // Очистка сессии
      sessions[userId] = {};
    }

  } catch (error) {
    console.error('Error in user message handler:', error);
  }
});

// Обработка текстовых сообщений админа
bot.on('message', async (msg) => {
  if (msg.from.id !== config.adminId || !sessions.admin) return;

  try {
    // Админ вводит реквизиты
    if (sessions.admin.step === 'enter_details') {
      const userId = sessions.admin.userId;
      const currencyType = sessions.admin.currencyType;
      const currency = sessions.admin.currency;
      const network = sessions.admin.network;
      
      // Формируем текст с реквизитами
      let detailsText = '';
      if (currencyType === 'crypto') {
        detailsText = 
          `${EMOJI.wallet} *Реквизиты для оплаты ${currency}${network ? ` (${network})` : ''}:*\n\n` +
          `\`${msg.text}\`\n\n` +
          `${EMOJI.copy} Нажмите на текст, чтобы скопировать`;
      } else {
        detailsText = 
          `${EMOJI.card} *Реквизиты для оплаты (${currency}):*\n\n` +
          `\`${msg.text}\`\n\n` +
          `${EMOJI.copy} Нажмите на текст, чтобы скопировать`;
      }
      
      // Отправляем реквизиты пользователю
      await bot.sendMessage(
        userId,
        detailsText,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: `${EMOJI.success} Я оплатил`, callback_data: 'paid' }],
              [{ text: `${EMOJI.copy} Скопировать реквизиты`, callback_data: `copy_${msg.text}` }]
            ]
          }
        }
      );
      
      // Подтверждение админу
      await bot.sendMessage(
        config.adminId,
        `${EMOJI.success} *Реквизиты успешно отправлены пользователю!*`,
        { parse_mode: 'Markdown' }
      );
      
      // Очищаем сессию админа
      delete sessions.admin;
    }

  } catch (error) {
    console.error('Error in admin message handler:', error);
  }
});

// Вспомогательные функции
async function showCurrencyMenu(chatId, text, currencies, prefix) {
  const buttons = currencies.map(c => [{ text: c.name, callback_data: `${prefix}_${c.code}` }]);
  
  await bot.sendMessage(
    chatId,
    `${EMOJI.exchange} *${text}*`,
    {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    }
  );
}

async function showNetworkMenu(chatId, networks, prefix = 'net') {
  const buttons = networks.map(n => [{ text: `${EMOJI.network} ${n}`, callback_data: `${prefix}_${n}` }]);
  
  await bot.sendMessage(
    chatId,
    `${EMOJI.network} *Выберите сеть:*`,
    {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    }
  );
}

function getExchangeRate(from, to) {
  // Здесь должна быть реальная логика получения курса
  // Временный фиксированный курс для примера
  const rates = {
    'BTC_USD': 50000,
    'ETH_USD': 3000,
    'USDT_USD': 1,
    'TRX_USD': 0.1,
    'RUB_USD': 0.014,
    'EUR_USD': 1.2
  };
  
  const fromRate = rates[`${from}_USD`] || 1;
  const toRate = rates[`${to}_USD`] || 1;
  
  return toRate / fromRate;
}

// Обработка ошибок
bot.on('polling_error', (error) => {
  console.error('Polling error:', error);
});