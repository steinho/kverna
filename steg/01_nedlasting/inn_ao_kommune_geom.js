const http = require("../../lib/http")
const config = require("../../config")
const log = require("log-less-fancy")()

// Laster ned geometri for kommuner i geojson format
http
  .downloadBinary2File(
    config.datakilde.ao_kommune_geom,
    config.getDataPath(__filename, ".zip")
  )
  .catch(err => {
    log.fatal(err)
  })
