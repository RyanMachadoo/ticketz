import React, { useEffect, useState } from "react";

import { makeStyles } from "@material-ui/core/styles";
import {
  Button,
  Link,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography
} from "@material-ui/core";

import MainContainer from "../../components/MainContainer";
import MainHeader from "../../components/MainHeader";
import MainHeaderButtonsWrapper from "../../components/MainHeaderButtonsWrapper";
import Title from "../../components/Title";
import TableRowSkeleton from "../../components/TableRowSkeleton";

import api from "../../services/api";
import { i18n } from "../../translate/i18n";
import toastError from "../../errors/toastError";

const useStyles = makeStyles(theme => ({
  mainPaper: {
    flex: 1,
    padding: theme.spacing(2),
    overflowY: "scroll",
    ...theme.scrollbarStyles
  },
  hint: { marginBottom: theme.spacing(2) },
  filters: {
    display: "flex",
    gap: 12,
    alignItems: "center",
    marginBottom: theme.spacing(2),
    flexWrap: "wrap"
  },
  total: { fontWeight: 600 },
  adCell: { maxWidth: 360 }
}));

const todayISO = () => new Date().toISOString().slice(0, 10);
const monthAgoISO = () => {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
};

const CtwaReport = () => {
  const classes = useStyles();

  const [startDate, setStartDate] = useState(monthAgoISO());
  const [endDate, setEndDate] = useState(todayISO());
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchReport = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/ctwa/report", {
        params: { startDate, endDate }
      });
      setRecords(Array.isArray(data.records) ? data.records : []);
    } catch (err) {
      toastError(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalLeads = records.reduce((acc, r) => acc + Number(r.leads || 0), 0);

  return (
    <MainContainer>
      <MainHeader>
        <Title>{i18n.t("ctwaReport.title")}</Title>
        <MainHeaderButtonsWrapper>
          <Button variant="contained" color="primary" onClick={fetchReport}>
            {i18n.t("ctwaReport.apply")}
          </Button>
        </MainHeaderButtonsWrapper>
      </MainHeader>

      <Typography className={classes.hint} variant="body2" color="textSecondary">
        {i18n.t("ctwaReport.hint")}
      </Typography>

      <div className={classes.filters}>
        <TextField
          label={i18n.t("ctwaReport.startDate")}
          type="date"
          value={startDate}
          onChange={e => setStartDate(e.target.value)}
          InputLabelProps={{ shrink: true }}
        />
        <TextField
          label={i18n.t("ctwaReport.endDate")}
          type="date"
          value={endDate}
          onChange={e => setEndDate(e.target.value)}
          InputLabelProps={{ shrink: true }}
        />
        <Typography variant="body2" className={classes.total}>
          {i18n.t("ctwaReport.totalLeads")}: {totalLeads}
        </Typography>
      </div>

      <Paper className={classes.mainPaper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{i18n.t("ctwaReport.table.ad")}</TableCell>
              <TableCell>{i18n.t("ctwaReport.table.adId")}</TableCell>
              <TableCell align="center">
                {i18n.t("ctwaReport.table.type")}
              </TableCell>
              <TableCell align="center">
                {i18n.t("ctwaReport.table.leads")}
              </TableCell>
              <TableCell align="center">
                {i18n.t("ctwaReport.table.contacts")}
              </TableCell>
              <TableCell align="center">
                {i18n.t("ctwaReport.table.lastAt")}
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRowSkeleton columns={6} />
            ) : records.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} align="center">
                  <Typography color="textSecondary">
                    {i18n.t("ctwaReport.empty")}
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              records.map((r, idx) => (
                <TableRow key={`${r.sourceId || "x"}-${idx}`}>
                  <TableCell className={classes.adCell}>
                    {r.sourceUrl ? (
                      <Link href={r.sourceUrl} target="_blank" rel="noopener">
                        {r.headline || i18n.t("ctwaReport.noHeadline")}
                      </Link>
                    ) : (
                      r.headline || i18n.t("ctwaReport.noHeadline")
                    )}
                  </TableCell>
                  <TableCell>{r.sourceId || "—"}</TableCell>
                  <TableCell align="center">{r.sourceType || "—"}</TableCell>
                  <TableCell align="center">{r.leads}</TableCell>
                  <TableCell align="center">{r.contacts}</TableCell>
                  <TableCell align="center">
                    {r.lastAt
                      ? new Date(r.lastAt).toLocaleString("pt-BR")
                      : "—"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Paper>
    </MainContainer>
  );
};

export default CtwaReport;
