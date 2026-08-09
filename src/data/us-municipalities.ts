/**
 * United States municipalities seed data for the Spider Agent queue.
 *
 * Source: US Census Bureau. This is a curated list of major US cities and
 * counties that publish council meeting agendas online. The Spider Agent
 * processes these one at a time from the queue.
 *
 * Each entry has: name, official website, region (City, State).
 */

export type MunicipalitySeed = {
  name: string;
  url: string;
  region: string;
};

export const usMunicipalities: MunicipalitySeed[] = [
  // Major cities
  { name: "New York City Council", url: "https://council.nyc.gov", region: "New York, New York" },
  { name: "Los Angeles City Council", url: "https://www.lacity.org", region: "Los Angeles, California" },
  { name: "Chicago City Council", url: "https://www.chicago.gov", region: "Chicago, Illinois" },
  { name: "Houston City Council", url: "https://www.houstontx.gov", region: "Houston, Texas" },
  { name: "Phoenix City Council", url: "https://www.phoenix.gov", region: "Phoenix, Arizona" },
  { name: "Philadelphia City Council", url: "https://phlcouncil.com", region: "Philadelphia, Pennsylvania" },
  { name: "San Antonio City Council", url: "https://www.sanantonio.gov", region: "San Antonio, Texas" },
  { name: "San Diego City Council", url: "https://www.sandiego.gov", region: "San Diego, California" },
  { name: "Dallas City Council", url: "https://dallascityhall.com", region: "Dallas, Texas" },
  { name: "San Jose City Council", url: "https://www.sanjoseca.gov", region: "San Jose, California" },
  { name: "Austin City Council", url: "https://www.austintexas.gov", region: "Austin, Texas" },
  { name: "Jacksonville City Council", url: "https://www.coj.net", region: "Jacksonville, Florida" },
  { name: "Fort Worth City Council", url: "https://www.fortworthtexas.gov", region: "Fort Worth, Texas" },
  { name: "Columbus City Council", url: "https://www.columbus.gov", region: "Columbus, Ohio" },
  { name: "Charlotte City Council", url: "https://www.charlottenc.gov", region: "Charlotte, North Carolina" },
  { name: "Indianapolis City Council", url: "https://www.indy.gov", region: "Indianapolis, Indiana" },
  { name: "San Francisco Board of Supervisors", url: "https://sfbos.org", region: "San Francisco, California" },
  { name: "Seattle City Council", url: "https://www.seattle.gov", region: "Seattle, Washington" },
  { name: "Denver City Council", url: "https://www.denvergov.org", region: "Denver, Colorado" },
  { name: "Boston City Council", url: "https://www.boston.gov", region: "Boston, Massachusetts" },
  { name: "El Paso City Council", url: "https://www.elpasotexas.gov", region: "El Paso, Texas" },
  { name: "Nashville Metro Council", url: "https://www.nashville.gov", region: "Nashville, Tennessee" },
  { name: "Detroit City Council", url: "https://www.detroitmi.gov", region: "Detroit, Michigan" },
  { name: "Oklahoma City Council", url: "https://www.okc.gov", region: "Oklahoma City, Oklahoma" },
  { name: "Portland City Council", url: "https://www.portland.gov", region: "Portland, Oregon" },
  { name: "Las Vegas City Council", url: "https://www.lasvegasnevada.gov", region: "Las Vegas, Nevada" },
  { name: "Memphis City Council", url: "https://www.memphis.gov", region: "Memphis, Tennessee" },
  { name: "Louisville Metro Council", url: "https://louisvilleky.gov", region: "Louisville, Kentucky" },
  { name: "Baltimore City Council", url: "https://www.baltimorecity.gov", region: "Baltimore, Maryland" },
  { name: "Milwaukee Common Council", url: "https://www.milwaukee.gov", region: "Milwaukee, Wisconsin" },
  { name: "Albuquerque City Council", url: "https://www.cabq.gov", region: "Albuquerque, New Mexico" },
  { name: "Tucson City Council", url: "https://www.tucsonaz.gov", region: "Tucson, Arizona" },
  { name: "Fresno City Council", url: "https://www.fresno.gov", region: "Fresno, California" },
  { name: "Sacramento City Council", url: "https://www.cityofsacramento.gov", region: "Sacramento, California" },
  { name: "Kansas City Council", url: "https://www.kcmo.gov", region: "Kansas City, Missouri" },
  { name: "Mesa City Council", url: "https://www.mesaaz.gov", region: "Mesa, Arizona" },
  { name: "Atlanta City Council", url: "https://www.atlantaga.gov", region: "Atlanta, Georgia" },
  { name: "Omaha City Council", url: "https://www.cityofomaha.org", region: "Omaha, Nebraska" },
  { name: "Colorado Springs City Council", url: "https://coloradosprings.gov", region: "Colorado Springs, Colorado" },
  { name: "Raleigh City Council", url: "https://www.raleighnc.gov", region: "Raleigh, North Carolina" },
  { name: "Miami City Council", url: "https://www.miamigov.com", region: "Miami, Florida" },
  { name: "Long Beach City Council", url: "https://www.longbeach.gov", region: "Long Beach, California" },
  { name: "Virginia Beach City Council", url: "https://www.vbgov.com", region: "Virginia Beach, Virginia" },
  { name: "Oakland City Council", url: "https://www.oaklandca.gov", region: "Oakland, California" },
  { name: "Minneapolis City Council", url: "https://www.minneapolismn.gov", region: "Minneapolis, Minnesota" },
  { name: "Tulsa City Council", url: "https://www.cityoftulsa.org", region: "Tulsa, Oklahoma" },
  { name: "Arlington City Council", url: "https://www.arlingtontx.gov", region: "Arlington, Texas" },
  { name: "Tampa City Council", url: "https://www.tampa.gov", region: "Tampa, Florida" },
  { name: "New Orleans City Council", url: "https://council.nola.gov", region: "New Orleans, Louisiana" },
  { name: "Pittsburgh City Council", url: "https://pittsburghpa.gov", region: "Pittsburgh, Pennsylvania" },
  { name: "Cincinnati City Council", url: "https://www.cincinnati-oh.gov", region: "Cincinnati, Ohio" },
  { name: "St. Louis City Council", url: "https://www.stlouis-mo.gov", region: "St. Louis, Missouri" },
  { name: "Cleveland City Council", url: "https://www.clevelandohio.gov", region: "Cleveland, Ohio" },

  // Washington
  { name: "Spokane City Council", url: "https://my.spokanecity.org", region: "Spokane, Washington" },
  { name: "Tacoma City Council", url: "https://www.cityoftacoma.org", region: "Tacoma, Washington" },
  { name: "Bellevue City Council", url: "https://bellevuewa.gov", region: "Bellevue, Washington" },

  // Oregon
  { name: "Eugene City Council", url: "https://www.eugene-or.gov", region: "Eugene, Oregon" },
  { name: "Salem City Council", url: "https://www.cityofsalem.net", region: "Salem, Oregon" },

  // California
  { name: "Santa Ana City Council", url: "https://www.santa-ana.org", region: "Santa Ana, California" },
  { name: "Anaheim City Council", url: "https://www.anaheim.net", region: "Anaheim, California" },
  { name: "Bakersfield City Council", url: "https://www.bakersfield.ca.us", region: "Bakersfield, California" },
  { name: "Riverside City Council", url: "https://www.riversideca.gov", region: "Riverside, California" },
  { name: "Stockton City Council", url: "https://www.stocktonca.gov", region: "Stockton, California" },
  { name: "Irvine City Council", url: "https://www.cityofirvine.org", region: "Irvine, California" },
  { name: "Chula Vista City Council", url: "https://www.chulavistaca.gov", region: "Chula Vista, California" },
  { name: "Fremont City Council", url: "https://www.fremont.gov", region: "Fremont, California" },
  { name: "San Bernardino City Council", url: "https://www.ci.san-bernardino.ca.us", region: "San Bernardino, California" },
  { name: "Modesto City Council", url: "https://www.modestogov.com", region: "Modesto, California" },

  // Texas
  { name: "Corpus Christi City Council", url: "https://www.cctexas.com", region: "Corpus Christi, Texas" },
  { name: "Plano City Council", url: "https://www.plano.gov", region: "Plano, Texas" },
  { name: "Lubbock City Council", url: "https://www.mylubbock.us", region: "Lubbock, Texas" },
  { name: "Garland City Council", url: "https://www.garlandtx.gov", region: "Garland, Texas" },
  { name: "Irving City Council", url: "https://www.cityofirving.org", region: "Irving, Texas" },
  { name: "Frisco City Council", url: "https://www.friscotexas.gov", region: "Frisco, Texas" },
  { name: "McKinney City Council", url: "https://www.mckinneytexas.org", region: "McKinney, Texas" },
  { name: "Amarillo City Council", url: "https://www.amarillo.gov", region: "Amarillo, Texas" },

  // Florida
  { name: "Orlando City Council", url: "https://www.orlando.gov", region: "Orlando, Florida" },
  { name: "St. Petersburg City Council", url: "https://www.stpete.org", region: "St. Petersburg, Florida" },
  { name: "Hialeah City Council", url: "https://www.hialeahfl.gov", region: "Hialeah, Florida" },
  { name: "Tallahassee City Council", url: "https://www.talgov.com", region: "Tallahassee, Florida" },
  { name: "Fort Lauderdale City Council", url: "https://www.fortlauderdale.gov", region: "Fort Lauderdale, Florida" },

  // Arizona
  { name: "Scottsdale City Council", url: "https://www.scottsdaleaz.gov", region: "Scottsdale, Arizona" },
  { name: "Glendale City Council", url: "https://www.glendaleaz.com", region: "Glendale, Arizona" },
  { name: "Peoria City Council", url: "https://www.peoriaaz.gov", region: "Peoria, Arizona" },
  { name: "Tempe City Council", url: "https://www.tempe.gov", region: "Tempe, Arizona" },

  // Colorado
  { name: "Aurora City Council", url: "https://www.auroragov.org", region: "Aurora, Colorado" },
  { name: "Fort Collins City Council", url: "https://www.fcgov.com", region: "Fort Collins, Colorado" },
  { name: "Boulder City Council", url: "https://bouldercolorado.gov", region: "Boulder, Colorado" },

  // Utah
  { name: "Salt Lake City Council", url: "https://www.slc.gov", region: "Salt Lake City, Utah" },
  { name: "Provo City Council", url: "https://provo.org", region: "Provo, Utah" },

  // Nevada
  { name: "Reno City Council", url: "https://www.reno.gov", region: "Reno, Nevada" },
  { name: "Henderson City Council", url: "https://www.cityofhenderson.com", region: "Henderson, Nevada" },

  // New Mexico
  { name: "Santa Fe City Council", url: "https://www.santafenm.gov", region: "Santa Fe, New Mexico" },

  // Georgia
  { name: "Savannah City Council", url: "https://www.savannahga.gov", region: "Savannah, Georgia" },
  { name: "Athens City Council", url: "https://www.athensclarke.com", region: "Athens, Georgia" },

  // North Carolina
  { name: "Charlotte City Council", url: "https://www.charlottenc.gov", region: "Charlotte, North Carolina" },
  { name: "Durham City Council", url: "https://www.durhamnc.gov", region: "Durham, North Carolina" },
  { name: "Winston-Salem City Council", url: "https://www.cityofws.org", region: "Winston-Salem, North Carolina" },

  // Tennessee
  { name: "Knoxville City Council", url: "https://www.knoxvilletn.gov", region: "Knoxville, Tennessee" },
  { name: "Chattanooga City Council", url: "https://www.chattanooga.gov", region: "Chattanooga, Tennessee" },

  // Wisconsin
  { name: "Madison City Council", url: "https://www.cityofmadison.com", region: "Madison, Wisconsin" },
  { name: "Green Bay City Council", url: "https://www.greenbaywi.gov", region: "Green Bay, Wisconsin" },

  // Minnesota
  { name: "St. Paul City Council", url: "https://www.stpaul.gov", region: "St. Paul, Minnesota" },

  // Iowa
  { name: "Des Moines City Council", url: "https://www.dsm.city", region: "Des Moines, Iowa" },

  // Nebraska
  { name: "Lincoln City Council", url: "https://www.lincoln.ne.gov", region: "Lincoln, Nebraska" },

  // Kansas
  { name: "Wichita City Council", url: "https://www.wichita.gov", region: "Wichita, Kansas" },

  // Missouri
  { name: "Kansas City Council", url: "https://www.kcmo.gov", region: "Kansas City, Missouri" },
  { name: "Springfield City Council", url: "https://www.springfieldmo.gov", region: "Springfield, Missouri" },

  // Ohio
  { name: "Cleveland City Council", url: "https://www.clevelandohio.gov", region: "Cleveland, Ohio" },
  { name: "Toledo City Council", url: "https://www.toledo.oh.gov", region: "Toledo, Ohio" },
  { name: "Akron City Council", url: "https://www.akronohio.gov", region: "Akron, Ohio" },

  // Michigan
  { name: "Grand Rapids City Council", url: "https://www.grandrapidsmi.gov", region: "Grand Rapids, Michigan" },

  // Indiana
  { name: "Fort Wayne City Council", url: "https://www.cityoffortwayne.org", region: "Fort Wayne, Indiana" },

  // Illinois
  { name: "Aurora City Council", url: "https://www.aurora-il.org", region: "Aurora, Illinois" },
  { name: "Naperville City Council", url: "https://www.naperville.il.us", region: "Naperville, Illinois" },

  // Pennsylvania
  { name: "Pittsburgh City Council", url: "https://pittsburghpa.gov", region: "Pittsburgh, Pennsylvania" },
  { name: "Allentown City Council", url: "https://www.allentownpa.gov", region: "Allentown, Pennsylvania" },

  // New York
  { name: "Buffalo Common Council", url: "https://www.buffalony.gov", region: "Buffalo, New York" },
  { name: "Rochester City Council", url: "https://www.cityofrochester.gov", region: "Rochester, New York" },

  // Massachusetts
  { name: "Cambridge City Council", url: "https://www.cambridgema.gov", region: "Cambridge, Massachusetts" },
  { name: "Worcester City Council", url: "https://www.worcesterma.gov", region: "Worcester, Massachusetts" },

  // Washington DC
  { name: "DC Council", url: "https://dccouncil.gov", region: "Washington, District of Columbia" },

  // Hawaii
  { name: "Honolulu City Council", url: "https://www.honolulu.gov", region: "Honolulu, Hawaii" },

  // Alaska
  { name: "Anchorage Assembly", url: "https://www.anchoragelike.com", region: "Anchorage, Alaska" },
];