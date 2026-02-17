-- Check if PolyBase is installed
DECLARE @IsPolyBaseInstalled INT = CAST(SERVERPROPERTY('IsPolyBaseInstalled') AS INT);

IF @IsPolyBaseInstalled = 0
BEGIN
    RAISERROR('ERROR: PolyBase is not installed. Please install SQL Server Developer or Enterprise Edition with PolyBase feature.', 16, 1);
END
ELSE
BEGIN
    PRINT 'PolyBase is installed.';
    
    -- Check if PolyBase is enabled
    DECLARE @PolyBaseEnabled INT;
    EXEC sp_configure 'show advanced options', 1;
    RECONFIGURE;
    
    SELECT @PolyBaseEnabled = CAST(value AS INT) 
    FROM sys.configurations 
    WHERE name = 'polybase enabled';
    
    IF @PolyBaseEnabled = 0
    BEGIN
        PRINT 'PolyBase is not enabled. Enabling PolyBase...';
        EXEC sp_configure 'polybase enabled', 1;
        RECONFIGURE;
        PRINT 'PolyBase has been enabled. Please restart SQL Server service for changes to take effect.';
    END
    ELSE
    BEGIN
        PRINT 'PolyBase is already enabled.';
    END
END
GO