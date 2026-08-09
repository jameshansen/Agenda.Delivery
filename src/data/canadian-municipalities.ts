/**
 * Canadian municipalities seed data for the Spider Agent queue.
 *
 * Source: Government of Canada / provincial directories. This is a curated
 * list of major Canadian municipalities that publish council meeting agendas
 * online. The Spider Agent processes these one at a time from the queue.
 *
 * Each entry has: name, official website, province/territory, region label.
 */

export type MunicipalitySeed = {
  name: string;
  url: string;
  region: string;
};

export const canadianMunicipalities: MunicipalitySeed[] = [
  // British Columbia
  { name: "City of Vancouver", url: "https://vancouver.ca", region: "Vancouver, British Columbia" },
  { name: "Township of Langley", url: "https://www.tol.ca", region: "Langley, British Columbia" },
  { name: "City of Langley", url: "https://www.langleycity.ca", region: "Langley, British Columbia" },
  { name: "City of Surrey", url: "https://www.surrey.ca", region: "Surrey, British Columbia" },
  { name: "City of Burnaby", url: "https://www.burnaby.ca", region: "Burnaby, British Columbia" },
  { name: "City of Richmond", url: "https://www.richmond.ca", region: "Richmond, British Columbia" },
  { name: "City of Coquitlam", url: "https://www.coquitlam.ca", region: "Coquitlam, British Columbia" },
  { name: "City of Victoria", url: "https://www.victoria.ca", region: "Victoria, British Columbia" },
  { name: "City of Kelowna", url: "https://www.kelowna.ca", region: "Kelowna, British Columbia" },
  { name: "City of Kamloops", url: "https://www.kamloops.ca", region: "Kamloops, British Columbia" },
  { name: "City of Nanaimo", url: "https://www.nanaimo.ca", region: "Nanaimo, British Columbia" },
  { name: "City of Prince George", url: "https://www.princegeorge.ca", region: "Prince George, British Columbia" },
  { name: "District of Saanich", url: "https://www.saanich.ca", region: "Saanich, British Columbia" },
  { name: "City of New Westminster", url: "https://www.newwestcity.ca", region: "New Westminster, British Columbia" },
  { name: "City of North Vancouver", url: "https://www.cnv.org", region: "North Vancouver, British Columbia" },
  { name: "District of North Vancouver", url: "https://www.dnv.org", region: "North Vancouver, British Columbia" },
  { name: "City of West Vancouver", url: "https://westvancouver.ca", region: "West Vancouver, British Columbia" },
  { name: "City of Port Moody", url: "https://www.portmoody.ca", region: "Port Moody, British Columbia" },
  { name: "City of Abbotsford", url: "https://www.abbotsford.ca", region: "Abbotsford, British Columbia" },
  { name: "City of Chilliwack", url: "https://www.chilliwack.ca", region: "Chilliwack, British Columbia" },
  { name: "City of Maple Ridge", url: "https://www.mapleridge.ca", region: "Maple Ridge, British Columbia" },
  { name: "City of Pitt Meadows", url: "https://www.pittmeadows.ca", region: "Pitt Meadows, British Columbia" },
  { name: "City of White Rock", url: "https://www.whiterockcity.ca", region: "White Rock, British Columbia" },
  { name: "Township of Esquimalt", url: "https://www.esquimalt.ca", region: "Esquimalt, British Columbia" },
  { name: "City of Colwood", url: "https://www.colwood.ca", region: "Colwood, British Columbia" },

  // Alberta
  { name: "City of Calgary", url: "https://www.calgary.ca", region: "Calgary, Alberta" },
  { name: "City of Edmonton", url: "https://www.edmonton.ca", region: "Edmonton, Alberta" },
  { name: "City of Red Deer", url: "https://www.reddeer.ca", region: "Red Deer, Alberta" },
  { name: "City of Lethbridge", url: "https://www.lethbridge.ca", region: "Lethbridge, Alberta" },
  { name: "City of St. Albert", url: "https://www.stalbert.ca", region: "St. Albert, Alberta" },
  { name: "City of Medicine Hat", url: "https://www.medicinehat.ca", region: "Medicine Hat, Alberta" },
  { name: "City of Grande Prairie", url: "https://www.cityofgp.com", region: "Grande Prairie, Alberta" },
  { name: "City of Airdrie", url: "https://www.airdrie.ca", region: "Airdrie, Alberta" },
  { name: "City of Spruce Grove", url: "https://www.sprucegrove.org", region: "Spruce Grove, Alberta" },
  { name: "Town of Banff", url: "https://www.banff.ca", region: "Banff, Alberta" },

  // Saskatchewan
  { name: "City of Saskatoon", url: "https://www.saskatoon.ca", region: "Saskatoon, Saskatchewan" },
  { name: "City of Regina", url: "https://www.regina.ca", region: "Regina, Saskatchewan" },
  { name: "City of Moose Jaw", url: "https://www.moosejaw.ca", region: "Moose Jaw, Saskatchewan" },
  { name: "City of Prince Albert", url: "https://www.citypa.ca", region: "Prince Albert, Saskatchewan" },

  // Manitoba
  { name: "City of Winnipeg", url: "https://www.winnipeg.ca", region: "Winnipeg, Manitoba" },
  { name: "City of Brandon", url: "https://www.brandon.ca", region: "Brandon, Manitoba" },

  // Ontario
  { name: "City of Toronto", url: "https://www.toronto.ca", region: "Toronto, Ontario" },
  { name: "City of Ottawa", url: "https://ottawa.ca", region: "Ottawa, Ontario" },
  { name: "City of Mississauga", url: "https://www.mississauga.ca", region: "Mississauga, Ontario" },
  { name: "City of Brampton", url: "https://www.brampton.ca", region: "Brampton, Ontario" },
  { name: "City of Hamilton", url: "https://www.hamilton.ca", region: "Hamilton, Ontario" },
  { name: "City of London", url: "https://london.ca", region: "London, Ontario" },
  { name: "City of Markham", url: "https://www.markham.ca", region: "Markham, Ontario" },
  { name: "City of Vaughan", url: "https://www.vaughan.ca", region: "Vaughan, Ontario" },
  { name: "City of Kitchener", url: "https://www.kitchener.ca", region: "Kitchener, Ontario" },
  { name: "City of Windsor", url: "https://www.citywindsor.ca", region: "Windsor, Ontario" },
  { name: "City of Richmond Hill", url: "https://www.richmondhill.ca", region: "Richmond Hill, Ontario" },
  { name: "City of Oakville", url: "https://www.oakville.ca", region: "Oakville, Ontario" },
  { name: "City of Burlington", url: "https://www.burlington.ca", region: "Burlington, Ontario" },
  { name: "City of Greater Sudbury", url: "https://www.greatersudbury.ca", region: "Greater Sudbury, Ontario" },
  { name: "City of Oshawa", url: "https://www.oshawa.ca", region: "Oshawa, Ontario" },
  { name: "City of Barrie", url: "https://www.barrie.ca", region: "Barrie, Ontario" },
  { name: "City of Guelph", url: "https://guelph.ca", region: "Guelph, Ontario" },
  { name: "City of Cambridge", url: "https://www.cambridge.ca", region: "Cambridge, Ontario" },
  { name: "City of Kingston", url: "https://www.cityofkingston.ca", region: "Kingston, Ontario" },
  { name: "City of Whitby", url: "https://www.whitby.ca", region: "Whitby, Ontario" },
  { name: "City of Ajax", url: "https://www.ajax.ca", region: "Ajax, Ontario" },
  { name: "City of St. Catharines", url: "https://www.stcatharines.ca", region: "St. Catharines, Ontario" },
  { name: "City of Niagara Falls", url: "https://niagarafalls.ca", region: "Niagara Falls, Ontario" },
  { name: "City of Peterborough", url: "https://www.peterborough.ca", region: "Peterborough, Ontario" },
  { name: "City of Thunder Bay", url: "https://www.thunderbay.ca", region: "Thunder Bay, Ontario" },
  { name: "City of Waterloo", url: "https://www.waterloo.ca", region: "Waterloo, Ontario" },
  { name: "City of Brantford", url: "https://www.brantford.ca", region: "Brantford, Ontario" },
  { name: "City of Chatham-Kent", url: "https://www.chatham-kent.ca", region: "Chatham-Kent, Ontario" },
  { name: "Town of Oakville", url: "https://www.oakville.ca", region: "Oakville, Ontario" },

  // Quebec
  { name: "Ville de Montreal", url: "https://montreal.ca", region: "Montreal, Quebec" },
  { name: "Ville de Quebec", url: "https://www.ville.quebec.qc.ca", region: "Quebec City, Quebec" },
  { name: "Ville de Laval", url: "https://www.laval.ca", region: "Laval, Quebec" },
  { name: "Ville de Gatineau", url: "https://www.gatineau.ca", region: "Gatineau, Quebec" },
  { name: "Ville de Longueuil", url: "https://www.longueuil.quebec", region: "Longueuil, Quebec" },
  { name: "Ville de Sherbrooke", url: "https://www.sherbrooke.ca", region: "Sherbrooke, Quebec" },
  { name: "Ville de Saguenay", url: "https://ville.saguenay.ca", region: "Saguenay, Quebec" },
  { name: "Ville de Levis", url: "https://www.ville.levis.qc.ca", region: "Levis, Quebec" },
  { name: "Ville de Trois-Rivieres", url: "https://www.ville.troisrivieres.qc.ca", region: "Trois-Rivieres, Quebec" },

  // New Brunswick
  { name: "City of Fredericton", url: "https://www.fredericton.ca", region: "Fredericton, New Brunswick" },
  { name: "City of Moncton", url: "https://www.moncton.ca", region: "Moncton, New Brunswick" },
  { name: "City of Saint John", url: "https://www.saintjohn.ca", region: "Saint John, New Brunswick" },

  // Nova Scotia
  { name: "Halifax Regional Municipality", url: "https://www.halifax.ca", region: "Halifax, Nova Scotia" },
  { name: "Cape Breton Regional Municipality", url: "https://www.cbrm.ns.ca", region: "Cape Breton, Nova Scotia" },

  // Prince Edward Island
  { name: "City of Charlottetown", url: "https://www.charlottetown.ca", region: "Charlottetown, Prince Edward Island" },
  { name: "City of Summerside", url: "https://www.city.summerside.pe.ca", region: "Summerside, Prince Edward Island" },

  // Newfoundland and Labrador
  { name: "City of St. John's", url: "https://www.stjohns.ca", region: "St. John's, Newfoundland and Labrador" },

  // Yukon
  { name: "City of Whitehorse", url: "https://www.whitehorse.ca", region: "Whitehorse, Yukon" },

  // Northwest Territories
  { name: "City of Yellowknife", url: "https://www.yellowknife.ca", region: "Yellowknife, Northwest Territories" },
];