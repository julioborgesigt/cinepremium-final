module.exports = (sequelize, DataTypes) => {
  const AdminDevice = sequelize.define('AdminDevice', {
    token: {
      type: DataTypes.STRING(255), // O token do FCM é uma string longa
      allowNull: false,
      unique: true, // Garante que o mesmo dispositivo não seja salvo duas vezes
    },
  }, {
    tableName: 'admin_devices',
    timestamps: true // Adiciona colunas createdAt e updatedAt
  });
  return AdminDevice;
};