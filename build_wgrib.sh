set -xeu

# wgrib 1
mkdir -p /usr/local/wgrib/
wget https://ftp.cpc.ncep.noaa.gov/wd51we/wgrib/wgrib.tar
mv wgrib.tar /usr/local/wgrib
cd /usr/local/wgrib
tar xvf wgrib.tar
make
rm wgrib.tar
ln -s /usr/local/wgrib/wgrib /usr/local/bin

# wgrib 2
mkdir -p /usr/local/grib2/
wget https://ftp.cpc.ncep.noaa.gov/wd51we/wgrib2/wgrib2.tgz
mv wgrib2.tgz /usr/local/grib2
cd /usr/local/grib2
tar -xf wgrib2.tgz
cd grib2
export FC=gfortran && export CC=gcc && 
make
ln -s /usr/local/grib2/grib2/wgrib2/wgrib2 /usr/local/bin/wgrib2
rm /usr/local/grib2/wgrib2.tgz
