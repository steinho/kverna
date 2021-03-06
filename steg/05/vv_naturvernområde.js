const io = require("../../lib/io")
const log = require("log-less-fancy")()
const config = require("../../config")
const typesystem = require("@artsdatabanken/typesystem")

let vo = io.lesDatafil("vv_med_kommune")
let vvKoder = io.lesKildedatafil("vv_naturvernområde")

function invert(o) {
  let r = {}
  Object.keys(vvKoder).map(key => {
    const o = vvKoder[key]
    const tittel = o.tittel.nb.toLowerCase()
    r[tittel] = key
  })
  return r
}

const tittel2Kode = invert(vvKoder)

let r = {}

function polygonArea(points) {
  const numPoints = points.length
  let area = 0
  let prev = points[numPoints - 1]
  for (let i = 0; i < numPoints; i++) {
    let cur = points[i]
    area += (prev[0] + cur[0]) * (prev[1] - cur[1])
    prev = cur
  }
  return area / 2
}

function multiPolygonArea(geometries) {
  let area = 0
  if (Array.isArray(geometries[0][0]))
    geometries.forEach(geom => (area += multiPolygonArea(geom)))
  else return polygonArea(geometries)
  return area
}

function kodeFraNavn(navn) {
  const kode = tittel2Kode[navn.toLowerCase()]
  if (!kode) throw new Error(`Finner ikke kode for '${navn}'`)
  return kode
}

function ordNummer(s, index) {
  if (!s) return null
  return s.split(" ")[index]
}

function relasjon(e, kant, kode, kantRetur, erSubset = true) {
  for (const rl of e.relasjon) if (rl.kode === kode) return

  const rel = { kode: kode, kant: kant, kantRetur: kantRetur || kant }
  if (erSubset) rel.erSubset = true
  e.relasjon.push(rel)
}

function førsteBokstavStor(s) {
  return s[0].toUpperCase() + s.slice(1)
}

function fjernRelasjon(e, kode) {
  for (let i = 0; i < e.relasjon.length; i++)
    if (e.relasjon[i].kode === kode) {
      e.relasjon.splice(i, 1)
      break
    }
}

function kobleForvaltningsmyndighet(kode, e) {
  if (e.data.forvaltningsmyndighet !== "fylkesmann") return
  const regexFylke = /VV-AO-(\d\d)/g
  let fylke = []
  e.relasjon.forEach(r => {
    const match = regexFylke.exec(r.kode)
    if (match) fylke.push(match[1])
  })
  //  if (kode === "VV_171") log.warn(fylke)
  if (fylke.length !== 1) return
  relasjon(e, "forvaltes av", "VV-FM-FM-" + fylke[0], "forvalter")
  fjernRelasjon(e, "VV-FM-FM")
}

function map(vo) {
  const props = vo.properties
  const iid = parseInt(props.IID.substring(2))
  const kode = typesystem.verneområde.leggTilPrefiks(iid)
  let e = {
    tittel: {
      nb: props.OMRADENAVN
    },
    infoUrl: config.infoUrl.verneområde + props.IID,
    relasjon: [],
    data: {
      areal: Math.round(multiPolygonArea(vo.geometry.coordinates)),
      vernedato: props.VERNEDATO,
      verneform: props.VERNEFORM.toLowerCase(),
      verneplan: props.VERNEPLAN.toLowerCase(),
      forvaltningsmyndighet: props.FORVALTNI.toLowerCase(),
      iucn: ordNummer(props.IUCN, 1)
    }
  }
  e.betegnelse = { nb: e.data.verneform.toLowerCase() }

  relasjon(e, "verneform", kodeFraNavn(e.data.verneform))
  relasjon(e, "verneplan", kodeFraNavn(e.data.verneplan))
  relasjon(
    e,
    "forvaltes av",
    kodeFraNavn(e.data.forvaltningsmyndighet),
    "forvalter"
  )
  if (props.TRUETVURD) {
    e.data.truetvurdering = props.TRUETVURD
    relasjon(e, "truet vurdering", kodeFraNavn(e.data.truetvurdering))
  }

  if (e.data.iucn) relasjon(e, "iucn", "VV-PA-" + e.data.iucn)
  relasjon(e, "ble vernet i år", "VV-VT-" + e.data.vernedato.substring(0, 4))
  if (new Date(props.DATO_REVID).getFullYear() > 1900)
    e.data.revisjonsdato = props.DATO_REVID

  // e.foreldre.push(typesystem.verneområde.prefiks)
  if (props.kommune) {
    props.kommune.forEach(kommune => {
      const fnr = kommune.substring(0, 2)
      const knr = kommune.substring(2)
      relasjon(e, "ligger i kommune", "VV-AO-" + fnr + "-" + knr)
      relasjon(e, "ligger i fylke", "VV-AO-" + fnr)
    })
  }
  kobleForvaltningsmyndighet(kode, e)
  r[kode] = e
}

function groupByKeys(filterFn) {
  let r = {}
  Object.keys(vo).forEach(key => {
    const o = vo[key]
    const k = filterFn(o)
    r[k] = r[k] + 1 || 1
  })
  return r
}

let manglerNøkler = false

function finnManglendeNøkler(fn, prefiks) {
  const keys = Object.keys(groupByKeys(vo => fn(vo.properties)))
  keys.forEach(key => {
    const tittel = key
    if (!tittel2Kode[tittel.toLowerCase()]) {
      manglerNøkler = true
      console.log(`"${prefiks}-???": {"tittel": {"nb": "${tittel}" }},`)
    }
  })
}

finnManglendeNøkler(p => p.FORVALTNI, "VV-FM")
finnManglendeNøkler(p => p.VERNEPLAN, "VV-VP")
finnManglendeNøkler(p => p.VERNEFORM, "VV-VF")
finnManglendeNøkler(p => p.TRUETVURD, "VV-TV")

if (manglerNøkler)
  log.warn(
    "Nøklene over mangler i typesystemet.  Legg dem inn i VV_naturvernområde.json manuelt."
  )

const år = {}
Object.keys(vo).forEach(key => {
  const o = vo[key]
  const y = o.properties.VERNEDATO.substring(0, 4)
  år[y] = år[y] + 1 || 1
})

Object.keys(vo).forEach(key => map(vo[key]))

io.skrivDatafil(__filename, r)
