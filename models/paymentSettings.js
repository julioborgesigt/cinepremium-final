module.exports = (sequelize, DataTypes) => {
  const PaymentSettings = sequelize.define('PaymentSettings', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    // Gateway ativo: 'ondapay', 'abacatepay' ou 'ciabra'
    activeGateway: {
      type: DataTypes.STRING(50),
      allowNull: false,
      defaultValue: 'ondapay',
      validate: {
        isIn: [['ondapay', 'abacatepay', 'ciabra']]
      }
    },
    // Campo para guardar configurações extras em JSON (futuro)
    settings: {
      type: DataTypes.TEXT,
      allowNull: true,
      get() {
        const rawValue = this.getDataValue('settings');
        return rawValue ? JSON.parse(rawValue) : {};
      },
      set(value) {
        this.setDataValue('settings', JSON.stringify(value));
      }
    }
  }, {
    tableName: 'payment_settings',
    timestamps: true
  });

  return PaymentSettings;
};
