// models/user.js - Modelo de usuário para banco de dados

module.exports = (sequelize, DataTypes) => {
  const User = sequelize.define('User', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    username: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: true,
      validate: {
        len: [3, 50],
        notEmpty: true
      }
    },
    email: {
      type: DataTypes.STRING(100),
      allowNull: false,
      unique: true,
      validate: {
        isEmail: true,
        notEmpty: true
      }
    },
    password: {
      type: DataTypes.STRING(255), // Hash bcrypt
      allowNull: false,
      validate: {
        notEmpty: true,
        isBcryptHash(value) {
          if (!value.startsWith('$2b$') && !value.startsWith('$2a$')) {
            throw new Error('Password must be a bcrypt hash');
          }
        }
      }
    },
    role: {
      type: DataTypes.ENUM('admin', 'manager', 'viewer'),
      allowNull: false,
      defaultValue: 'viewer'
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
    },
    lastLogin: {
      type: DataTypes.DATE,
      allowNull: true
    },
    loginAttempts: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    lockedUntil: {
      type: DataTypes.DATE,
      allowNull: true
    }
  }, {
    tableName: 'users',
    timestamps: true, // createdAt, updatedAt
    indexes: [
      {
        name: 'idx_username',
        fields: ['username'],
        unique: true
      },
      {
        name: 'idx_email',
        fields: ['email'],
        unique: true
      },
      {
        name: 'idx_role',
        fields: ['role']
      }
    ],
    hooks: {
      // Hook para garantir que senha esteja sempre em bcrypt
      beforeCreate: async (user) => {
        if (!user.password.startsWith('$2b$') && !user.password.startsWith('$2a$')) {
          const bcrypt = require('bcrypt');
          user.password = await bcrypt.hash(user.password, 10);
        }
      },
      beforeUpdate: async (user) => {
        if (user.changed('password')) {
          if (!user.password.startsWith('$2b$') && !user.password.startsWith('$2a$')) {
            const bcrypt = require('bcrypt');
            user.password = await bcrypt.hash(user.password, 10);
          }
        }
      }
    }
  });

  // Métodos de instância
  User.prototype.validatePassword = async function(password) {
    const bcrypt = require('bcrypt');
    return await bcrypt.compare(password, this.password);
  };

  User.prototype.incrementLoginAttempts = async function() {
    this.loginAttempts += 1;

    // Bloquear após 5 tentativas
    if (this.loginAttempts >= 5) {
      this.lockedUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 min
    }

    await this.save();
  };

  User.prototype.resetLoginAttempts = async function() {
    this.loginAttempts = 0;
    this.lockedUntil = null;
    this.lastLogin = new Date();
    await this.save();
  };

  User.prototype.isLocked = function() {
    return this.lockedUntil && this.lockedUntil > new Date();
  };

  // Métodos estáticos
  User.createAdmin = async function(username, email, password) {
    return await User.create({
      username,
      email,
      password, // Será hashado pelo hook
      role: 'admin',
      isActive: true
    });
  };

  return User;
};
