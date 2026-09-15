VW roster source (2026-09-15): the Standalone Dealer Search feature app on vw.com/en/dealer-search.html loads
the entire US dealer network with one GET (observed in the Browser pane via performance entries):

  https://v3-92-0.ds-us.dcc.feature-app.io/bff-search/dealers
    ?serviceConfigEndpoint={"endpoint":{"type":"publish","country":"us","language":"en","content":"onehub_pkw","envName":"prod","testScenarioId":null},"signature":"VehBWLTr2hxx8TJ85NJrpgRXoPfAyNcz2K8KuyXQTNI="}
    &lufthansaApiKey=h0CQWvPYSBvp5KYXUpRU4FpZrnl0tZx1
    &query={"type":"DEALER","language":"en-US","countryCode":"US","dealerServiceFilter":[],"contentDealerServiceFilter":["ACCES_CNFG","DCA"],"usePrimaryTenant":true,"name":" "}

(URL-encode the JSON params; plain curl works.) The key and signature come from vw.com's en.feature-apps.json /
en.global-config.json and may rotate. Response: {"dealers":[{id, name, address{street,city,province,postalCode},
contact{phoneNumber,website,email,person}, coordinates[lat,lng], features[...]}]} — 954 rows, saved as
bff_dealers_raw.json; roster_raw.json / roster.csv drop PR/GU/VI.
