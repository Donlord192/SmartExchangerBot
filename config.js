module.exports = {
  token: '11111111',
  adminId: 123456789, // твой Telegram ID для админ-панели
  rates: {
    EUR_RUB: 90,       // 1 EUR = 90 RUB
    RUB_EUR: 1/90,
    BTC_USD: 27000,
    ETH_USD: 1800,
    USDT_USD: 1,
    TRX_USD: 0.065,
    // Для упрощения курсы между криптами считать через USD
  },
};