Description: REST API smoke — Star Wars API

Meta:
    @feature swapi
    @layer api

Scenario: Verify Luke Skywalker's eye color
When I execute HTTP GET request for resource with URL `https://swapi.info/api/people/1/`
Then `${responseCode}` is equal to `200`
Then JSON element value from `${response}` by JSON path `$.eye_color` is equal to `blue`
When I save JSON element value from `${response}` by JSON path `$.homeworld` to scenario variable `homeworldUrl`

Scenario: Verify Luke's homeworld is Tatooine
When I execute HTTP GET request for resource with URL `${homeworldUrl}`
Then response code is equal to `200`
Then JSON element value from `${response}` by JSON path `$.name` is equal to `Tatooine`
Then JSON element value from `${response}` by JSON path `$.terrain` matches `.*desert.*`

Scenario: Iterate films, assert each has a title and director
When I execute HTTP GET request for resource with URL `https://swapi.info/api/films/`
Then `${responseCode}` is equal to `200`
When I find > `0` JSON elements from `${response}` by `$.[*]` and for each element do
|step                                                                                |
|Then JSON element value from `${json-context}` by JSON path `$.title` matches `.+`  |
|Then JSON element value from `${json-context}` by JSON path `$.director` matches `.+`|

Scenario: POST with body and assert echo
When I set request headers:
|name        |value           |
|Content-Type|application/json|
Given request body: {"hello":"#{generate(Internet.username)}","ts":"#{generateDate(P0D, yyyy-MM-dd)}"}
When I execute HTTP POST request for resource with URL `https://httpbin.org/post`
Then response code is equal to `200`
Then JSON element value from `${response}` by JSON path `$.headers.Content-Type` is equal to `application/json`
