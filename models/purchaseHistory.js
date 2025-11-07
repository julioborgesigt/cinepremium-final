module.exports = (sequelize, DataTypes) => {
  const PurchaseHistory = sequelize.define('PurchaseHistory', {
    nome: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    telefone: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    transactionId: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    status: {
      // CORREÇÃO: Usar ENUM ao invés de STRING para validação
      type: DataTypes.ENUM('Gerado', 'Sucesso', 'Falhou', 'Expirado'),
      allowNull: false,
      defaultValue: 'Gerado',
    },
    dataTransacao: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    // Novo campo para contar as verificações já realizadas
    checkCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    }
  }, {
    tableName: 'purchase_histories',
    timestamps: false,
    // CORREÇÃO: Adicionar índices para melhorar performance
    indexes: [
      {
        name: 'idx_telefone',
        fields: ['telefone']
      },
      {
        name: 'idx_dataTransacao',
        fields: ['dataTransacao']
      },
      {
        name: 'idx_telefone_dataTransacao',
        fields: ['telefone', 'dataTransacao']
      },
      {
        name: 'idx_transactionId',
        fields: ['transactionId'],
        unique: true,
        where: {
          transactionId: { [sequelize.Sequelize.Op.ne]: null }
        }
      },
      {
        name: 'idx_status',
        fields: ['status']
      }
    ]
  });
  return PurchaseHistory;
};
