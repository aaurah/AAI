require('dotenv').config();
const { sequelize, User, Role, Permission } = require('../models');
const { seed } = require('./seedData');

(async () => {
  await sequelize.authenticate();
  await sequelize.sync({ force: process.argv.includes('--fresh') });
  await seed();
  console.log('Seed complete.');
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
