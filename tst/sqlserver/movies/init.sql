IF DB_ID('Movies') IS NULL
BEGIN
  CREATE DATABASE Movies;
END
GO

USE Movies;
GO

USE Movies;
GO

IF OBJECT_ID('dbo.Movies', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.Movies (
    MovieId INT IDENTITY(1,1) PRIMARY KEY,
    Title NVARCHAR(200) NOT NULL,
    ReleaseYear INT NULL
  );
END
GO

IF OBJECT_ID('dbo.Ratings', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.Ratings (
    RatingId INT IDENTITY(1,1) PRIMARY KEY,
    MovieId INT NOT NULL,
    Rating DECIMAL(3,1) NOT NULL,
    RatedAt DATETIME2 NOT NULL,
    CONSTRAINT FK_Ratings_Movies FOREIGN KEY (MovieId) REFERENCES dbo.Movies(MovieId)
  );
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.Movies)
BEGIN
  INSERT INTO dbo.Movies (Title, ReleaseYear)
  VALUES
    (N'Blade Runner', 1982),
    (N'Arrival', 2016),
    (N'Dune', 2021);
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.Ratings)
BEGIN
  INSERT INTO dbo.Ratings (MovieId, Rating, RatedAt)
  VALUES
    (1, 8.1, SYSUTCDATETIME()),
    (2, 7.9, SYSUTCDATETIME()),
    (3, 8.0, SYSUTCDATETIME());
END
GO

USE master;
GO

IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = 'polybase_user')
BEGIN
  CREATE LOGIN polybase_user WITH PASSWORD = 'PolyBase!Passw0rd';
END
GO

USE Movies;
GO

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'polybase_user')
BEGIN
  CREATE USER polybase_user FOR LOGIN polybase_user;
END
GO

EXEC sp_addrolemember 'db_datareader', 'polybase_user';
GRANT VIEW DEFINITION TO polybase_user;
GO
