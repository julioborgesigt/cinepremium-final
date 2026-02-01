/**
 * Módulo de Tratamento de Erros Centralizado
 * Padroniza respostas de erro em toda a aplicação
 */

/**
 * Classe base para erros da aplicação
 */
class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Erro de validação
 */
class ValidationError extends AppError {
  constructor(message, field = null) {
    super(message, 400, 'VALIDATION_ERROR');
    this.field = field;
  }
}

/**
 * Erro de gateway de pagamento
 */
class GatewayError extends AppError {
  constructor(message, gateway, originalError = null) {
    super(message, 502, 'GATEWAY_ERROR');
    this.gateway = gateway;
    this.originalError = originalError;
  }
}

/**
 * Erro de autenticação
 */
class AuthError extends AppError {
  constructor(message = 'Não autorizado') {
    super(message, 401, 'AUTH_ERROR');
  }
}

/**
 * Erro de recurso não encontrado
 */
class NotFoundError extends AppError {
  constructor(resource = 'Recurso') {
    super(`${resource} não encontrado`, 404, 'NOT_FOUND');
    this.resource = resource;
  }
}

/**
 * Erro de rate limit
 */
class RateLimitError extends AppError {
  constructor(message = 'Muitas requisições. Tente novamente mais tarde.') {
    super(message, 429, 'RATE_LIMIT');
  }
}

/**
 * Erro de configuração
 */
class ConfigurationError extends AppError {
  constructor(message, configKey = null) {
    super(message, 500, 'CONFIG_ERROR');
    this.configKey = configKey;
  }
}

/**
 * Formata erro de API externa para resposta
 * @param {Error} error - Erro capturado
 * @param {string} gateway - Nome do gateway
 * @returns {object} Objeto de erro formatado
 */
function formatApiError(error, gateway) {
  let errorMessage = 'Erro ao processar pagamento. Tente novamente.';
  let errorDetails = null;
  let errorCode = null;

  if (error.response && error.response.data) {
    const apiError = error.response.data;
    errorCode = error.response.status;
    errorDetails = apiError;

    // Tratamento específico por gateway
    switch (gateway.toLowerCase()) {
      case 'abacatepay':
        if (apiError.error) {
          errorMessage = `[AbacatePay] ${apiError.error}`;
        }
        break;

      case 'ondapay':
        if (apiError.msg) {
          const msgValue = typeof apiError.msg === 'object'
            ? Object.values(apiError.msg)[0]
            : apiError.msg;
          errorMessage = `[OndaPay] ${msgValue}`;
        }
        break;

      case 'ciabra':
        if (apiError.message) {
          errorMessage = `[CIABRA] ${apiError.message}`;
        }
        if (apiError.code) {
          errorCode = apiError.code;
        }
        break;

      default:
        if (apiError.message) {
          errorMessage = apiError.message;
        }
    }
  } else {
    errorMessage = error.message || errorMessage;
    errorDetails = {
      localError: true,
      message: error.message
    };
  }

  return {
    error: errorMessage,
    details: errorDetails,
    httpCode: errorCode,
    gateway
  };
}

/**
 * Handler de erro para Express
 * @param {Error} err - Erro capturado
 * @param {object} req - Request object
 * @param {object} res - Response object
 * @param {function} next - Next middleware
 */
function errorHandler(err, req, res, next) {
  // Se já enviou resposta, delega para o handler padrão do Express
  if (res.headersSent) {
    return next(err);
  }

  // Erros operacionais conhecidos
  if (err.isOperational) {
    return res.status(err.statusCode).json({
      error: err.message,
      code: err.code
    });
  }

  // Erros inesperados - log completo mas resposta genérica
  console.error('Erro inesperado:', err);

  return res.status(500).json({
    error: 'Erro interno do servidor',
    code: 'INTERNAL_ERROR'
  });
}

module.exports = {
  AppError,
  ValidationError,
  GatewayError,
  AuthError,
  NotFoundError,
  RateLimitError,
  ConfigurationError,
  formatApiError,
  errorHandler
};
