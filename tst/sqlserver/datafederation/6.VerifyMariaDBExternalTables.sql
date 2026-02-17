use DataFederationDB;

go

select *
from Books.Books b
join Books.Ratings r on b.BookId = r.BookId
go