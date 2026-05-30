const { Sequelize } = require('sequelize');
const path = require('path');
const fs = require('fs');

let sequelize;

if (process.env.DATABASE_URL) {
  sequelize = new Sequelize(process.env.DATABASE_URL, {
    logging: process.env.NODE_ENV === 'development' ? console.log : false,
  });
} else {
  const storageDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(storageDir)) fs.mkdirSync(storageDir, { recursive: true });

  sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: process.env.DB_STORAGE || path.join(storageDir, 'admin.db'),
    logging: process.env.NODE_ENV === 'development' ? console.log : false,
  });
}

module.exports = sequelize;
