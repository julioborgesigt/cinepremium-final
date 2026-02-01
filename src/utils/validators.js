/**
 * Módulo de Validações Centralizadas
 * Contém todas as funções de validação usadas pelos gateways
 */

const validator = require('validator');
const xss = require('xss');

/**
 * Valida CPF brasileiro
 * @param {string} cpf - CPF a ser validado
 * @returns {boolean} True se válido
 */
function isValidCPF(cpf) {
  if (!cpf) return false;

  // Remove caracteres não numéricos
  cpf = cpf.replace(/\D/g, '');

  // Verifica se tem 11 dígitos
  if (cpf.length !== 11) return false;

  // Verifica se todos os dígitos são iguais
  if (/^(\d)\1+$/.test(cpf)) return false;

  // Validação do primeiro dígito verificador
  let soma = 0;
  for (let i = 0; i < 9; i++) {
    soma += parseInt(cpf.charAt(i)) * (10 - i);
  }
  let resto = (soma * 10) % 11;
  if (resto === 10 || resto === 11) resto = 0;
  if (resto !== parseInt(cpf.charAt(9))) return false;

  // Validação do segundo dígito verificador
  soma = 0;
  for (let i = 0; i < 10; i++) {
    soma += parseInt(cpf.charAt(i)) * (11 - i);
  }
  resto = (soma * 10) % 11;
  if (resto === 10 || resto === 11) resto = 0;
  if (resto !== parseInt(cpf.charAt(10))) return false;

  return true;
}

/**
 * Valida telefone brasileiro (11 dígitos)
 * @param {string} phone - Telefone a ser validado
 * @returns {boolean} True se válido
 */
function isValidPhone(phone) {
  if (!phone) return false;

  // Remove caracteres não numéricos
  const cleanPhone = phone.replace(/\D/g, '');

  // Verifica se tem 10 ou 11 dígitos (com ou sem 9)
  return cleanPhone.length === 10 || cleanPhone.length === 11;
}

/**
 * Valida email
 * @param {string} email - Email a ser validado
 * @returns {boolean} True se válido
 */
function isValidEmail(email) {
  if (!email) return false;
  return validator.isEmail(email);
}

/**
 * Normaliza email (lowercase, remove pontos do gmail, etc)
 * @param {string} email - Email a ser normalizado
 * @returns {string} Email normalizado
 */
function normalizeEmail(email) {
  if (!email) return email;
  return validator.normalizeEmail(email) || email;
}

/**
 * Sanitiza input para prevenir XSS
 * @param {string} input - Input a ser sanitizado
 * @returns {string} Input sanitizado
 */
function sanitizeInput(input) {
  if (typeof input !== 'string') return input;

  return xss(validator.trim(input), {
    whiteList: {},
    stripIgnoreTag: true,
    stripIgnoreTagBody: ['script', 'style']
  });
}

/**
 * Limpa CPF (remove caracteres não numéricos)
 * @param {string} cpf - CPF a ser limpo
 * @returns {string} CPF apenas com números
 */
function cleanCPF(cpf) {
  if (!cpf) return '';
  return cpf.replace(/\D/g, '');
}

/**
 * Limpa telefone (remove caracteres não numéricos)
 * @param {string} phone - Telefone a ser limpo
 * @returns {string} Telefone apenas com números
 */
function cleanPhone(phone) {
  if (!phone) return '';
  return phone.replace(/\D/g, '');
}

/**
 * Valida valor de pagamento
 * @param {number|string} value - Valor a ser validado
 * @returns {boolean} True se válido
 */
function isValidPaymentValue(value) {
  const numValue = parseFloat(value);
  return !isNaN(numValue) && numValue > 0;
}

/**
 * Converte valor em centavos para reais
 * @param {number} cents - Valor em centavos
 * @returns {number} Valor em reais
 */
function centsToReais(cents) {
  return Number((cents / 100).toFixed(2));
}

/**
 * Converte valor em reais para centavos
 * @param {number} reais - Valor em reais
 * @returns {number} Valor em centavos
 */
function reaisToCents(reais) {
  return Math.round(reais * 100);
}

/**
 * Valida dados de pagamento completos
 * @param {object} data - Dados do pagamento
 * @returns {object} { valid: boolean, errors: string[] }
 */
function validatePaymentData(data) {
  const errors = [];

  if (!data.value || !isValidPaymentValue(data.value)) {
    errors.push('Valor do produto inválido.');
  }

  if (!data.nome || data.nome.length < 3) {
    errors.push('Nome inválido ou muito curto.');
  }

  if (!data.cpf || !isValidCPF(data.cpf)) {
    errors.push('CPF inválido.');
  }

  if (!data.email || !isValidEmail(data.email)) {
    errors.push('E-mail inválido.');
  }

  if (!data.telefone || !isValidPhone(data.telefone)) {
    errors.push('Telefone inválido. Deve conter 10 ou 11 dígitos.');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

module.exports = {
  isValidCPF,
  isValidPhone,
  isValidEmail,
  normalizeEmail,
  sanitizeInput,
  cleanCPF,
  cleanPhone,
  isValidPaymentValue,
  centsToReais,
  reaisToCents,
  validatePaymentData
};
