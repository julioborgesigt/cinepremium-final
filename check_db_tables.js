require('dotenv').config();
const { Sequelize } = require('sequelize');

const sequelize = new Sequelize(
  process.env.DB_NAME, 
  process.env.DB_USER, 
  process.env.DB_PASS, 
  {
    host: process.env.DB_HOST,
    dialect: 'mysql',
    logging: false
  }
);

(async () => {
  try {
    await sequelize.authenticate();
    console.log('Connected to database successfully\n');
    console.log('=== ALL TABLES ===\n');
    
    const [tables] = await sequelize.query('SHOW TABLES');
    
    if (tables.length === 0) {
      console.log('No tables found');
    } else {
      tables.forEach((row) => {
        const tableName = Object.values(row)[0];
        console.log(`- ${tableName}`);
      });
      
      console.log('\n=== PRODUCT-RELATED TABLES ===\n');
      const productTables = tables.filter(row => {
        const tableName = (Object.values(row)[0] || '').toLowerCase();
        return tableName.includes('product');
      });
      
      if (productTables.length === 0) {
        console.log('No product-related tables found');
      } else {
        for (const row of productTables) {
          const tableName = Object.values(row)[0];
          console.log(`\nTable: ${tableName}`);
          
          const [columns] = await sequelize.query(`DESCRIBE \`${tableName}\``);
          console.log('Columns:');
          columns.forEach(col => {
            console.log(`  - ${col.Field} (${col.Type})`);
          });
        }
      }
    }
    
    await sequelize.close();
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
})();
