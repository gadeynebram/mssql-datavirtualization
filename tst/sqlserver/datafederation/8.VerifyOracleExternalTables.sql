USE DataFederationDB;
GO

-- Query the AIRPLANE external table
SELECT 
    AIRPLANE_ID,
    REGISTRATION,
    MODEL,
    MANUFACTURER,
    CAPACITY,
    YEAR_BUILT
FROM Aviation.AIRPLANE
ORDER BY AIRPLANE_ID;
GO

-- Query the FLIGHT external table
SELECT 
    FLIGHT_ID,
    FLIGHT_NUMBER,
    AIRPLANE_ID,
    DEPARTURE_AIRPORT,
    ARRIVAL_AIRPORT,
    DEPARTURE_TIME,
    ARRIVAL_TIME,
    STATUS
FROM Aviation.FLIGHT
ORDER BY FLIGHT_ID;
GO

-- Join query to show airplane details with flights
SELECT 
    f.FLIGHT_NUMBER,
    a.REGISTRATION,
    a.MODEL,
    f.DEPARTURE_AIRPORT,
    f.ARRIVAL_AIRPORT,
    f.DEPARTURE_TIME,
    f.STATUS
FROM Aviation.FLIGHT f
INNER JOIN Aviation.AIRPLANE a ON f.AIRPLANE_ID = a.AIRPLANE_ID
ORDER BY f.DEPARTURE_TIME;
GO

-- Count records
SELECT 
    'Airplanes' AS TableName,
    COUNT(*) AS RecordCount
FROM Aviation.AIRPLANE
UNION ALL
SELECT 
    'Flights' AS TableName,
    COUNT(*) AS RecordCount
FROM Aviation.FLIGHT;
GO
