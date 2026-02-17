use DataFederationDB

go

select *
from Movies m
join Ratings r on m.MovieId = r.MovieId