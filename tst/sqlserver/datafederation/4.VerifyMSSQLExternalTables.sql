use DataFederationDB

go

/*Assuming you've used Movies as a schema name*/

select *
from Movies.Movies m
join Movies.Ratings r on m.MovieId = r.MovieId