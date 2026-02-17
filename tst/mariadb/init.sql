USE Books;

CREATE TABLE IF NOT EXISTS Books (
  BookId INT AUTO_INCREMENT PRIMARY KEY,
  Title VARCHAR(200) NOT NULL,
  Author VARCHAR(200) NOT NULL,
  PublishedYear INT NULL
);

CREATE TABLE IF NOT EXISTS Ratings (
  RatingId INT AUTO_INCREMENT PRIMARY KEY,
  BookId INT NOT NULL,
  Rating DOUBLE NOT NULL,
  RatedAt DATETIME NOT NULL,
  CONSTRAINT FK_Ratings_Books FOREIGN KEY (BookId) REFERENCES Books(BookId)
);

INSERT INTO Books (Title, Author, PublishedYear)
SELECT * FROM (
  SELECT 'The Left Hand of Darkness', 'Ursula K. Le Guin', 1969 UNION ALL
  SELECT 'The Three-Body Problem', 'Liu Cixin', 2006 UNION ALL
  SELECT 'Anathem', 'Neal Stephenson', 2008
) AS seed
WHERE NOT EXISTS (SELECT 1 FROM Books);

INSERT INTO Ratings (BookId, Rating, RatedAt)
SELECT * FROM (
  SELECT 1, 9.1, NOW() UNION ALL
  SELECT 2, 8.7, NOW() UNION ALL
  SELECT 3, 8.4, NOW()
) AS seed
WHERE NOT EXISTS (SELECT 1 FROM Ratings);
