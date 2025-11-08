-- ============================================================
-- MIGRAÇÃO: Consolidar tabelas Product e Products
-- ============================================================
-- Este script SQL consolida as tabelas Product/Products em uma única tabela Product
--
-- COMO USAR:
--   mysql -u seu_usuario -p nome_do_banco < migrate-product-table.sql
--
-- OU dentro do MySQL:
--   USE nome_do_banco;
--   source migrate-product-table.sql;
--
-- ============================================================

-- Criar procedure temporária para a migração
DELIMITER $$

DROP PROCEDURE IF EXISTS migrate_product_tables$$

CREATE PROCEDURE migrate_product_tables()
BEGIN
    DECLARE products_exists INT DEFAULT 0;
    DECLARE product_exists INT DEFAULT 0;
    DECLARE products_count INT DEFAULT 0;
    DECLARE product_count INT DEFAULT 0;
    DECLARE migrated_count INT DEFAULT 0;

    -- Verificar se a tabela Products existe
    SELECT COUNT(*) INTO products_exists
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
    AND table_name = 'Products';

    -- Verificar se a tabela Product existe
    SELECT COUNT(*) INTO product_exists
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
    AND table_name = 'Product';

    -- Exibir status inicial
    SELECT '============================================================' AS '';
    SELECT '  MIGRAÇÃO DE TABELAS PRODUCT' AS '';
    SELECT '============================================================' AS '';
    SELECT '' AS '';
    SELECT '🔍 Verificando tabelas...' AS '';
    SELECT '' AS '';

    SELECT CONCAT('Tabela Products (plural): ',
                  IF(products_exists > 0, '✅ Existe', '❌ Não existe')) AS Status;
    SELECT CONCAT('Tabela Product (singular): ',
                  IF(product_exists > 0, '✅ Existe', '❌ Não existe')) AS Status;
    SELECT '' AS '';

    -- CENÁRIO 1: Nenhuma tabela existe
    IF products_exists = 0 AND product_exists = 0 THEN
        SELECT 'ℹ️  Nenhuma tabela Product encontrada.' AS '';
        SELECT '   A tabela será criada automaticamente quando o servidor rodar.' AS '';
        SELECT '' AS '';

    -- CENÁRIO 2: Só Product existe - tudo certo
    ELSEIF product_exists > 0 AND products_exists = 0 THEN
        SELECT COUNT(*) INTO product_count FROM `Product`;
        SELECT '✅ Tudo certo! Apenas a tabela Product (singular) existe.' AS '';
        SELECT CONCAT('   Registros na tabela: ', product_count) AS '';
        SELECT '   Nenhuma migração necessária.' AS '';
        SELECT '' AS '';

    -- CENÁRIO 3: Só Products existe - renomear
    ELSEIF products_exists > 0 AND product_exists = 0 THEN
        SELECT COUNT(*) INTO products_count FROM `Products`;
        SELECT '📦 Encontrada tabela Products (plural) com dados antigos.' AS '';
        SELECT CONCAT('   Registros encontrados: ', products_count) AS '';
        SELECT '' AS '';
        SELECT '🔄 Renomeando tabela Products → Product...' AS '';

        RENAME TABLE `Products` TO `Product`;

        SELECT '✅ Migração concluída com sucesso!' AS '';
        SELECT '   Tabela renomeada: Products → Product' AS '';
        SELECT CONCAT('   ', products_count, ' registros preservados') AS '';
        SELECT '' AS '';

    -- CENÁRIO 4: Ambas existem - mesclar
    ELSEIF products_exists > 0 AND product_exists > 0 THEN
        SELECT COUNT(*) INTO products_count FROM `Products`;
        SELECT COUNT(*) INTO product_count FROM `Product`;

        SELECT '⚠️  ATENÇÃO: Ambas as tabelas existem!' AS '';
        SELECT '' AS '';
        SELECT CONCAT('   Products (antiga): ', products_count, ' registros') AS '';
        SELECT CONCAT('   Product (atual):   ', product_count, ' registros') AS '';
        SELECT '' AS '';

        -- Se Products está vazia, só remove
        IF products_count = 0 THEN
            SELECT '🗑️  Tabela Products está vazia. Removendo...' AS '';
            DROP TABLE `Products`;
            SELECT '✅ Tabela Products removida com sucesso!' AS '';
            SELECT '' AS '';
        ELSE
            SELECT '🔄 Iniciando mesclagem de dados...' AS '';
            SELECT '' AS '';

            -- Copiar dados que não existem em Product (evitar duplicatas)
            INSERT INTO `Product` (id, title, price, image, description, orderIndex, createdAt, updatedAt)
            SELECT id, title, price, image, description, orderIndex, createdAt, updatedAt
            FROM `Products`
            WHERE id NOT IN (SELECT id FROM `Product`);

            -- Contar quantos registros foram migrados
            SET migrated_count = ROW_COUNT();

            SELECT CONCAT('✅ ', migrated_count, ' registros copiados') AS '';
            SELECT CONCAT('   Total na tabela Product: ', product_count + migrated_count) AS '';
            SELECT '' AS '';

            -- Remover tabela antiga
            SELECT '🗑️  Removendo tabela Products antiga...' AS '';
            DROP TABLE `Products`;

            SELECT '' AS '';
            SELECT '✅ Migração concluída com sucesso!' AS '';
            SELECT CONCAT('   Dados mesclados: ', migrated_count, ' novos registros') AS '';
            SELECT CONCAT('   Total final: ', product_count + migrated_count, ' registros') AS '';
            SELECT '   Tabela Products removida' AS '';
            SELECT '' AS '';
        END IF;
    END IF;

    SELECT '============================================================' AS '';
    SELECT '  MIGRAÇÃO FINALIZADA' AS '';
    SELECT '============================================================' AS '';
    SELECT '' AS '';

END$$

DELIMITER ;

-- Executar a procedure
CALL migrate_product_tables();

-- Remover a procedure temporária
DROP PROCEDURE IF EXISTS migrate_product_tables;
